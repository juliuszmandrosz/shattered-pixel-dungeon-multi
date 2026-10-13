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
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Hero;
import com.shatteredpixel.shatteredpixeldungeon.actors.mobs.Mob;
import com.shatteredpixel.shatteredpixeldungeon.utils.GLog;
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
 *   incoming  uid TAB seq TAB type TAB payload   (flattened by the JS bridge)
 */
public class Coop {

	public static boolean enabled = false;
	public static String localPlayer = null;
	public static ArrayList<String> players = new ArrayList<>();

	/** Set while a queued action is being applied, so the gated input paths let it through. */
	public static boolean applying = false;

	public interface Transport {
		void send( String json );
	}
	public static Transport transport = null;

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

	public static void reset(){
		enabled = false;
		localPlayer = null;
		players.clear();
		synchronized (queues) { queues.clear(); }
		lastSeq = -1;
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

	public static void submitRest( boolean full ){
		submit( "rest", full ? "1" : "0" );
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
		try {
			switch (action.type) {
				case "cell":
					return hero.handle( Integer.parseInt( action.payload ) );
				case "rest":
					hero.rest( "1".equals( action.payload ) );
					return true;
				default:
					GLog.w( "unknown co-op action: " + action.type );
					return false;
			}
		} catch (NumberFormatException e) {
			return false;
		} finally {
			Gdx.app.log( "coop", "applied seq=" + action.seq + " " + action.type + " " + action.payload
					+ " hero=" + indexOf( hero ) + " checksum=" + Long.toHexString( checksum() ) );
			applying = false;
		}
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
			h = 31 * h + Float.floatToIntBits( hero.cooldown() );
		}
		if (Dungeon.level != null) {
			for (Mob mob : Dungeon.level.mobs) {
				h = 31 * h + mob.pos;
				h = 31 * h + mob.HP;
			}
			h = 31 * h + Arrays.hashCode( Dungeon.level.heroFOV );
		}
		return h;
	}
}
