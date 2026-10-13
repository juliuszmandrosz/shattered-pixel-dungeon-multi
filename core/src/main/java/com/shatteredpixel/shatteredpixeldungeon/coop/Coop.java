/*
 * Pixel Dungeon
 * Copyright (C) 2012-2015 Oleg Dolya
 *
 * Shattered Pixel Dungeon
 * Copyright (C) 2014-2026 Evan Debenham
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>
 */

package com.shatteredpixel.shatteredpixeldungeon.coop;

import com.badlogic.gdx.Gdx;
import com.shatteredpixel.shatteredpixeldungeon.Dungeon;
import com.shatteredpixel.shatteredpixeldungeon.actors.Actor;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Belongings;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Hero;
import com.shatteredpixel.shatteredpixeldungeon.actors.mobs.Mob;
import com.shatteredpixel.shatteredpixeldungeon.items.Item;
import com.shatteredpixel.shatteredpixeldungeon.items.bags.Bag;
import com.shatteredpixel.shatteredpixeldungeon.scenes.CellSelector;
import com.shatteredpixel.shatteredpixeldungeon.scenes.GameScene;
import com.shatteredpixel.shatteredpixeldungeon.utils.GLog;
import com.shatteredpixel.shatteredpixeldungeon.windows.WndBag;
import com.watabou.utils.Random;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;

/**
 * Deterministic lockstep co-op. Every client runs the full simulation; only player actions
 * travel over the network. An action is applied by every client at the same point of the
 * simulation: when the hero it belongs to runs {@link Hero#act()} with nothing to do.
 *
 * Players are identified by the ids the lobby hands out; the hero at index i of
 * {@link Dungeon#heroes} belongs to the player at index i of {@link #players}.
 *
 * Wire format (one message per action, relayed by the page that hosts the game):
 *   outgoing  {"spd":"action","type":T,"payload":P}
 *   incoming  uid TAB seq TAB type TAB payload   (flattened by the JS bridge; seq is the
 *             global delivery index, identical on every client)
 *
 * Action types: cell (tap on the map), target (answer to a cell selector opened by an item),
 * item (path|action), pick (answer to an item selector), rest (1/0), search, check (seq:hash,
 * not an action: a state fingerprint other clients compare with their own).
 */
public class Coop {

	public static boolean enabled = false;
	public static String localPlayer = null;
	public static ArrayList<String> players = new ArrayList<>();

	/** Set while a queued action is being applied, so the gated input paths let it through. */
	public static boolean applying = false;

	/** True once a checksum from another client disagreed with ours. */
	public static boolean desynced = false;

	/** Selectors opened by an item while an action was applied; answered through the queue. */
	public static CellSelector.Listener proxiedCellListener = null;
	public static WndBag.ItemSelector proxiedItemSelector = null;

	public interface Transport {
		void send( String json );
	}
	public static Transport transport = null;

	private static int announcedTurn = -1;

	/** Tells the hosting page which hero is waiting for input, for the turn order HUD. */
	public static void announceTurn( Hero hero ){
		if (!enabled || transport == null) return;
		int index = indexOf( hero );
		if (index == announcedTurn) return;
		announcedTurn = index;
		transport.send( "{\"spd\":\"turn\",\"hero\":" + index + "}" );
	}

	/** Asks the hosting page to leave the game (back to the lobby). */
	public static void leave(){
		if (transport != null) transport.send( "{\"spd\":\"leave\"}" );
	}

	public static class Action {
		public final String uid;
		public final long seq;
		public final String type;
		public final String payload;

		Action( String uid, long seq, String type, String payload ) {
			this.uid = uid;
			this.seq = seq;
			this.type = type;
			this.payload = payload;
		}
	}

	private static final HashMap<Integer, ArrayDeque<Action>> queues = new HashMap<>();
	private static long lastSeq = -1;
	//checksums of our applied actions, and the ones other clients reported, by seq
	private static final HashMap<Long, Long> applied = new HashMap<>();
	private static final HashMap<Long, Long> reported = new HashMap<>();

	public static void reset(){
		enabled = false;
		localPlayer = null;
		announcedTurn = -1;
		players.clear();
		synchronized (queues) { queues.clear(); }
		lastSeq = -1;
		applied.clear();
		reported.clear();
		desynced = false;
		applying = false;
		proxiedCellListener = null;
		proxiedItemSelector = null;
	}

	public static int localIndex(){
		return players.indexOf( localPlayer );
	}

	public static int indexOf( Hero hero ){
		return Dungeon.heroes.indexOf( hero );
	}

	public static boolean isLocal( Hero hero ){
		return !enabled || indexOf( hero ) == localIndex();
	}

	/** Name of the player who owns the hero, for UI messages. */
	public static String ownerOf( Hero hero ){
		int i = indexOf( hero );
		return i >= 0 && i < players.size() ? players.get( i ) : "?";
	}

	// ---- outgoing ----

	public static void submitCell( int cell ){
		submit( "cell", Integer.toString( cell ) );
	}

	public static void submitTarget( int cell ){
		submit( "target", Integer.toString( cell ) );
	}

	public static void submitRest( boolean full ){
		submit( "rest", full ? "1" : "0" );
	}

	public static void submitSearch(){
		submit( "search", "" );
	}

	public static void submitItem( Hero hero, Item item, String action ){
		String path = itemPath( hero, item );
		if (path == null) {
			GLog.w( "That item cannot be used in co-op." );
			return;
		}
		submit( "item", path + "|" + action );
	}

	/**
	 * UI entry point for using an item (quickslot, inventory, item window). In co-op the use is
	 * sent as an action and applied on the owner's turn by every client; otherwise it executes.
	 * Gating here rather than in Item.execute matters: subclasses such as Wand keep acting after
	 * super.execute returns, and the game itself calls execute during the simulation.
	 */
	public static void useItem( Hero hero, Item item, String action ){
		if (enabled && !applying) {
			submitItem( hero, item, action == null ? item.defaultAction() : action );
			return;
		}
		if (action == null) item.execute( hero ); else item.execute( hero, action );
	}

	/** Item selection by the owner: sent instead of answering the selector directly. */
	public static void selectItem( WndBag.ItemSelector selector, Item item ){
		if (enabled && !applying && selector == proxiedItemSelector) {
			String path = itemPath( Dungeon.localHero(), item );
			if (path != null) submit( "pick", path );
			return;
		}
		selector.onSelect( item );
	}

	public static void submit( String type, String payload ){
		if (transport == null) return;
		transport.send( "{\"spd\":\"action\",\"type\":\"" + type + "\",\"payload\":\"" + payload + "\"}" );
	}

	// ---- incoming ----

	/**
	 * Called from the JS message callback. Must not block or touch the simulation: it only
	 * queues the action and releases the actor thread if that hero is waiting for input.
	 */
	public static void receive( String flat ){
		String[] parts = flat.split( "\t", 4 );
		if (parts.length < 4) return;
		String uid = parts[0];
		long seq;
		try { seq = Long.parseLong( parts[1] ); } catch (NumberFormatException e) { return; }
		if (seq <= lastSeq) return; //duplicate delivery
		lastSeq = seq;

		if ("check".equals( parts[2] )) {
			if (!uid.equals( localPlayer )) compareChecksum( parts[3] );
			return;
		}

		int heroIndex = players.indexOf( uid );
		if (heroIndex < 0) return;

		Action action = new Action( uid, seq, parts[2], parts[3] );
		synchronized (queues) {
			ArrayDeque<Action> queue = queues.get( heroIndex );
			if (queue == null) queues.put( heroIndex, queue = new ArrayDeque<>() );
			queue.add( action );
		}

		//the owner's hero may be parked in act() waiting for exactly this
		if (heroIndex < Dungeon.heroes.size()) {
			Hero hero = Dungeon.heroes.get( heroIndex );
			if (hero.ready && Actor.processing()) {
				hero.next();
			}
		}
	}

	/** Next queued action for the hero, or null. Called from the actor thread only. */
	public static Action poll( Hero hero ){
		synchronized (queues) {
			ArrayDeque<Action> queue = queues.get( indexOf( hero ) );
			return queue == null ? null : queue.poll();
		}
	}

	/** Turns a queued action into hero state, exactly like local input would. */
	public static boolean apply( Hero hero, Action action ){
		applying = true;
		boolean result = false;
		try {
			switch (action.type) {
				case "cell":
					result = hero.handle( Integer.parseInt( action.payload ) );
					break;
				case "target":
					result = answerCell( Integer.parseInt( action.payload ) );
					break;
				case "item": {
					int bar = action.payload.lastIndexOf( '|' );
					if (bar > 0) {
						Item item = resolveItem( hero, action.payload.substring( 0, bar ) );
						if (item != null) {
							item.execute( hero, action.payload.substring( bar + 1 ) );
							result = true;
						} else {
							GLog.w( "co-op: item not found for " + action.payload );
						}
					}
					break;
				}
				case "pick": {
					WndBag.ItemSelector selector = proxiedItemSelector;
					proxiedItemSelector = null;
					if (selector != null) {
						selector.onSelect( resolveItem( hero, action.payload ) );
						result = true;
					}
					break;
				}
				case "rest":
					hero.rest( "1".equals( action.payload ) );
					result = true;
					break;
				case "search":
					hero.search( true );
					result = true;
					break;
				default:
					GLog.w( "unknown co-op action: " + action.type );
			}
		} catch (NumberFormatException e) {
			result = false;
		} finally {
			applying = false;
			long sum = checksum();
			applied.put( action.seq, sum );
			Gdx.app.log( "coop", "applied seq=" + action.seq + " " + action.type + " " + action.payload
					+ " hero=" + indexOf( hero ) + " checksum=" + Long.toHexString( sum ) + " " + checksumDetail() );
			Long expected = reported.remove( action.seq );
			if (expected != null && expected != sum) flagDesync( action.seq );
			submit( "check", action.seq + ":" + Long.toHexString( sum ) );
		}
		return result;
	}

	private static boolean answerCell( int cell ){
		CellSelector.Listener listener = proxiedCellListener;
		proxiedCellListener = null;
		if (listener == null) {
			GLog.w( "co-op: no target was being chosen" );
			return false;
		}
		GameScene.ready();
		listener.onSelect( cell );
		return true;
	}

	private static void compareChecksum( String payload ){
		int colon = payload.indexOf( ':' );
		if (colon < 0) return;
		try {
			long seq = Long.parseLong( payload.substring( 0, colon ) );
			//TeaVM has no Long.parseUnsignedLong, parse the hex digits by hand
			long sum = 0;
			for (char c : payload.substring( colon + 1 ).toCharArray()) {
				int digit = Character.digit( c, 16 );
				if (digit < 0) return;
				sum = (sum << 4) | digit;
			}
			Long ours = applied.get( seq );
			if (ours == null) {
				reported.put( seq, sum );
			} else if (ours != sum) {
				flagDesync( seq );
			}
		} catch (NumberFormatException e) {
			//ignore malformed checks
		}
	}

	private static void flagDesync( long seq ){
		if (desynced) return;
		desynced = true;
		Gdx.app.error( "coop", "desync detected at seq " + seq );
		GLog.n( "Out of sync with the other players (action " + seq + "). Reload the page to catch up." );
	}

	// ---- item paths: a stable address of an item inside a hero's belongings ----

	public static String itemPath( Hero hero, Item item ){
		Belongings b = hero.belongings;
		if (item == b.weapon) return "w";
		if (item == b.armor) return "a";
		if (item == b.artifact) return "f";
		if (item == b.misc) return "m";
		if (item == b.ring) return "r";
		if (item == b.secondWep) return "s";
		for (int i = 0; i < b.backpack.items.size(); i++) {
			Item it = b.backpack.items.get( i );
			if (it == item) return "b:" + i;
			if (it instanceof Bag) {
				ArrayList<Item> inner = ((Bag) it).items;
				for (int j = 0; j < inner.size(); j++) {
					if (inner.get( j ) == item) return "b:" + i + ":" + j;
				}
			}
		}
		return null;
	}

	public static Item resolveItem( Hero hero, String path ){
		Belongings b = hero.belongings;
		switch (path) {
			case "w": return b.weapon;
			case "a": return b.armor;
			case "f": return b.artifact;
			case "m": return b.misc;
			case "r": return b.ring;
			case "s": return b.secondWep;
		}
		if (!path.startsWith( "b:" )) return null;
		String[] idx = path.substring( 2 ).split( ":" );
		try {
			int i = Integer.parseInt( idx[0] );
			if (i < 0 || i >= b.backpack.items.size()) return null;
			Item it = b.backpack.items.get( i );
			if (idx.length == 1) return it;
			int j = Integer.parseInt( idx[1] );
			if (!(it instanceof Bag) || j < 0 || j >= ((Bag) it).items.size()) return null;
			return ((Bag) it).items.get( j );
		} catch (NumberFormatException e) {
			return null;
		}
	}

	/** The checksum's ingredients, for finding out what diverged. */
	public static String checksumDetail(){
		StringBuilder b = new StringBuilder();
		b.append( "now=" ).append( Actor.now() );
		b.append( " rng=" ).append( Long.toHexString( Random.simulationState() ) );
		b.append( " depth=" ).append( Dungeon.depth );
		for (Hero hero : Dungeon.heroes) {
			b.append( " h[" ).append( hero.pos ).append( "," ).append( hero.HP ).append( "," )
					.append( hero.belongings.backpack.items.size() ).append( "," ).append( hero.cooldown() ).append( "]" );
		}
		if (Dungeon.level != null) {
			b.append( " mobs=" );
			for (Mob mob : Dungeon.level.mobs) b.append( mob.pos ).append( ":" ).append( mob.HP ).append( "," );
			b.append( " heaps=" ).append( Dungeon.level.heaps.size );
			b.append( " fov=" ).append( Integer.toHexString( Arrays.hashCode( Dungeon.level.heroFOV ) ) );
		}
		return b.toString();
	}

	/** Fingerprint of the simulation state; identical on every client while they are in sync. */
	public static long checksum(){
		long h = 1125899906842597L;
		h = 31 * h + Float.floatToIntBits( Actor.now() );
		h = 31 * h + Random.simulationState();
		h = 31 * h + Dungeon.depth;
		for (Hero hero : Dungeon.heroes) {
			h = 31 * h + hero.pos;
			h = 31 * h + hero.HP;
			h = 31 * h + hero.belongings.backpack.items.size();
			h = 31 * h + Float.floatToIntBits( hero.cooldown() );
		}
		if (Dungeon.level != null) {
			for (Mob mob : Dungeon.level.mobs) {
				h = 31 * h + mob.pos;
				h = 31 * h + mob.HP;
			}
			h = 31 * h + Dungeon.level.heaps.size;
			h = 31 * h + Arrays.hashCode( Dungeon.level.heroFOV );
		}
		return h;
	}
}
