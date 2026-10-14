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
import com.shatteredpixel.shatteredpixeldungeon.actors.Char;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.HeroAction;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Talent;
import com.shatteredpixel.shatteredpixeldungeon.actors.buffs.HoldFast;
import com.shatteredpixel.shatteredpixeldungeon.actors.buffs.Buff;
import com.shatteredpixel.shatteredpixeldungeon.actors.Actor;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Belongings;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Hero;
import com.shatteredpixel.shatteredpixeldungeon.actors.mobs.Mob;
import com.shatteredpixel.shatteredpixeldungeon.items.Item;
import com.shatteredpixel.shatteredpixeldungeon.items.bags.Bag;
import com.shatteredpixel.shatteredpixeldungeon.scenes.CellSelector;
import com.shatteredpixel.shatteredpixeldungeon.scenes.GameScene;
import com.shatteredpixel.shatteredpixeldungeon.sprites.CharSprite;
import com.shatteredpixel.shatteredpixeldungeon.utils.GLog;
import com.shatteredpixel.shatteredpixeldungeon.windows.WndBag;
import com.watabou.utils.Random;

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
 * item (path|action), pick (answer to an item selector), rest (1/0), search, wait, resume,
 * skip (hero:epoch, "nothing new for this hero": a walking hero keeps walking, an idle one
 * lets a turn pass), check (count:hash, not an action: a state fingerprint other clients
 * compare with their own).
 *
 * Turn flow (see docs/getting-started-web.md, "The log invariant"): entries are consumed from
 * one log in seq order. A hero with something to do (a walk, resting) needs the entry at the
 * cursor before every step: its own entry redirects or confirms it, a foreign one lets it
 * carry on. An idle hero with no enemy in the party's sight takes its own entry at the cursor
 * or lets a turn pass when the cursor holds someone else's entry. An idle hero while an enemy
 * is visible waits for its own next entry wherever it is in the log (a strict turn). The
 * page writes the skip entries that keep time flowing: at once for its own busy or idle hero
 * while others move, after a short delay for absent players, and only after a long timeout
 * for a strict turn.
 */
public class Coop {

	public static boolean enabled = false;
	public static String localPlayer = null;
	public static ArrayList<String> players = new ArrayList<>();

	/** Set while a queued action is being applied, so the gated input paths let it through. */
	public static boolean applying = false;

	/**
	 * Diagnostics only (URL param legacyticks=1): keep the rule from before 2026-10-14, where an
	 * idle hero let its turn pass on a skip its own client had written ahead for a walk. Lets a
	 * room recorded under that rule be replayed faithfully in the harness.
	 */
	public static boolean ownTicksPass = false;

	/** True once a checksum from another client disagreed with ours. */
	public static boolean desynced = false;

	/** Selectors opened by an item while an action was applied; answered through the queue. */
	public static CellSelector.Listener proxiedCellListener = null;
	public static WndBag.ItemSelector proxiedItemSelector = null;

	public interface Transport {
		void send( String json );
	}
	public static Transport transport = null;

	private static String announced = null;

	/** Display names of the players, in player order (from the lobby, for messages). */
	public static ArrayList<String> names = new ArrayList<>();

	//the hero the simulation is parked on, and whether that is a strict turn (idle hero while
	//an enemy is in sight: only its own order moves the game on). UI only.
	public static int waitingHero = -1;
	public static boolean waitingStrict = false;

	//orders applied per hero, in log order: identical on every client, so a "skip" sent for
	//(hero, epoch) is accepted or dropped identically everywhere
	private static final HashMap<Integer, Integer> epochs = new HashMap<>();

	public static int epoch( Hero hero ){
		Integer e = epochs.get( indexOf( hero ) );
		return e == null ? 0 : e;
	}

	/** Number of enemies in the merged party field of view (what every client sees on the map). */
	public static int partyVisibleEnemies(){
		if (Dungeon.level == null || Dungeon.level.heroFOV == null) return 0;
		int n = 0;
		for (Mob mob : Dungeon.level.mobs) {
			if (mob.alignment == Char.Alignment.ENEMY && mob.pos >= 0 && mob.pos < Dungeon.level.heroFOV.length
					&& Dungeon.level.heroFOV[mob.pos]) {
				n++;
			}
		}
		return n;
	}

	/** True when any party member had an enemy in sight when it last acted (simulation state). */
	public static boolean partySeesEnemy(){
		for (Hero h : Dungeon.heroes) {
			if (h.isAlive() && h.seesEnemy()) return true;
		}
		return false;
	}

	/**
	 * Tells the hosting page where the simulation stands, for the turn HUD and for the skip
	 * entries it writes: the hero whose act() is next, its epoch, whether an enemy is in sight,
	 * whether the simulation is parked on that hero right now, every hero's state and epoch.
	 */
	public static void announce( Hero hero, boolean waiting ){
		if (!enabled || transport == null) return;
		StringBuilder states = new StringBuilder();
		StringBuilder epochList = new StringBuilder();
		for (Hero h : Dungeon.heroes) {
			if (states.length() > 0) { states.append( ',' ); epochList.append( ',' ); }
			states.append( '"' ).append( !h.isAlive() ? "dead" : h.resting ? "rest" : h.isBusy() ? "walk" : "idle" ).append( '"' );
			epochList.append( epoch( h ) );
		}
		String msg = "{\"spd\":\"turn\",\"hero\":" + indexOf( hero ) + ",\"epoch\":" + epoch( hero )
				+ ",\"danger\":" + partySeesEnemy() + ",\"waiting\":" + waiting + ",\"states\":[" + states
				+ "],\"epochs\":[" + epochList + "]}";
		if (msg.equals( announced )) return;
		announced = msg;
		transport.send( msg );
	}

	/** Name of the player who owns the hero, for UI messages. */
	public static String nameOf( int heroIndex ){
		if (heroIndex >= 0 && heroIndex < names.size()) return names.get( heroIndex );
		return "player " + (heroIndex + 1);
	}

	/**
	 * Whether this client's player may give the hero an order now. Only a strict turn of another
	 * hero refuses: while an enemy is in sight and the simulation waits for someone else's
	 * decision, a tap would otherwise fire later, during the player's own turn, as a surprise.
	 * A hero already walking may still be redirected.
	 */
	public static boolean mayOrder( Hero hero ){
		if (!enabled || hero == null) return true;
		if (!waitingStrict || waitingHero < 0 || waitingHero == indexOf( hero )) return true;
		return hero.isBusy();
	}

	/** Feedback for an order refused by {@link #mayOrder}. */
	public static void refuseOrder(){
		GLog.w( "Not your turn: " + nameOf( waitingHero ) + " is deciding." );
		Hero local = Dungeon.localHero();
		if (local != null && local.sprite != null) local.sprite.showStatus( CharSprite.WARNING, "not your turn" );
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
		/** Index of the hero the entry is for (the sender's hero, or the hero named by a skip). */
		public final int hero;
		boolean consumed = false;

		Action( String uid, long seq, String type, String payload, int hero ) {
			this.uid = uid;
			this.seq = seq;
			this.type = type;
			this.payload = payload;
			this.hero = hero;
		}
	}

	/** Verdicts of {@link #next(Hero)} besides an entry to apply. */
	public static final Action WAIT = new Action( "", -1, "wait", "", -1 );
	public static final Action CONTINUE = new Action( "", -1, "continue", "", -1 );
	public static final Action PASS = new Action( "", -1, "pass", "", -1 );

	//every order received, in seq order (the page delivers them contiguously)
	private static final ArrayList<Action> log = new ArrayList<>();
	//index of the first entry not consumed yet
	private static int cursor = 0;
	private static long lastSeq = -1;
	//applied entries and passes so far (identical on every client); every CHECK_EVERY-th one
	//sends a checksum, keyed by this count
	private static int applies = 0;
	private static final int CHECK_EVERY = 4;
	//checksums of our applied actions, and the ones other clients reported, by apply count
	private static final HashMap<Long, Long> applied = new HashMap<>();
	private static final HashMap<Long, Long> reported = new HashMap<>();

	public static void reset(){
		enabled = false;
		localPlayer = null;
		announced = null;
		epochs.clear();
		players.clear();
		names.clear();
		waitingHero = -1;
		waitingStrict = false;
		synchronized (log) { log.clear(); cursor = 0; }
		lastSeq = -1;
		applies = 0;
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

	/**
	 * UI entry point for "the hero should act on this cell" (tap, attack button, loot button,
	 * keyboard move). In co-op it becomes a queued action for the local hero, otherwise it is
	 * handled right away like upstream does.
	 */
	public static void handleCell( Hero hero, int cell ){
		if (enabled && !applying) {
			if (isLocal( hero ) && allowed( hero )) submitCell( cell );
			return;
		}
		if (hero.handle( cell )) hero.next();
	}

	/**
	 * Stop what the hero is doing (a walk, a full rest) without spending a turn: the toolbar's
	 * first press while busy, GameScene.cancel. Through the log, like every change to a hero.
	 */
	public static void cancel( Hero hero ){
		if (enabled && !applying) {
			if (isLocal( hero ) && allowed( hero )) submit( "cancel", "" );
			return;
		}
		hero.curAction = null;
		hero.resting = false;
	}

	/** Resume an interrupted path (the resume indicator). */
	public static void resume( Hero hero ){
		if (enabled && !applying) {
			if (isLocal( hero ) && allowed( hero )) submit( "resume", "" );
			return;
		}
		hero.resume();
	}

	/** The toolbar's wait/pick-up button: pick up what is here, otherwise rest a turn. */
	public static void waitOrPickup( Hero hero ){
		if (enabled && !applying) {
			if (isLocal( hero ) && allowed( hero )) submit( "wait", "" );
			return;
		}
		applyWait( hero );
	}

	private static void applyWait( Hero hero ){
		hero.waitOrPickup = true;
		if ((Dungeon.level.heaps.get( hero.pos ) != null || hero.canSelfTrample()) && hero.handle( hero.pos )) {
			//trigger hold fast and patient strike here, even if the hero didn't specifically wait
			if (hero.hasTalent( Talent.HOLD_FAST )) {
				Buff.affect( hero, HoldFast.class ).pos = hero.pos;
			}
			if (hero.hasTalent( Talent.PATIENT_STRIKE )) {
				Buff.affect( hero, Talent.PatientStrikeTracker.class ).pos = hero.pos;
			}
			hero.next();
		} else {
			hero.rest( false );
		}
	}

	public static void submitTarget( int cell ){
		submit( "target", Integer.toString( cell ) );
	}

	public static void submitRest( boolean full ){
		if (allowed( Dungeon.localHero() )) submit( "rest", full ? "1" : "0" );
	}

	public static void submitSearch(){
		if (allowed( Dungeon.localHero() )) submit( "search", "" );
	}

	//a player's own order is refused with feedback during somebody else's strict turn
	private static boolean allowed( Hero hero ){
		if (mayOrder( hero )) return true;
		refuseOrder();
		return false;
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
			if (allowed( hero )) submitItem( hero, item, action == null ? item.defaultAction() : action );
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
	 * appends the entry to the log and releases the actor thread if a hero is parked on the log.
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

		int heroIndex;
		if ("skip".equals( parts[2] )) {
			//a skip names the hero in its payload, whoever wrote it
			int colon = parts[3].indexOf( ':' );
			try {
				heroIndex = Integer.parseInt( colon < 0 ? parts[3] : parts[3].substring( 0, colon ) );
			} catch (NumberFormatException e) {
				return;
			}
		} else {
			heroIndex = players.indexOf( uid );
		}
		if (heroIndex < 0 || heroIndex >= players.size()) return;

		synchronized (log) {
			log.add( new Action( uid, seq, parts[2], parts[3], heroIndex ) );
		}

		//a hero may be parked in act() waiting for exactly this
		Actor acting = Actor.current();
		if (acting instanceof Hero && ((Hero) acting).awaitingLog) {
			acting.next();
		}
	}

	/** Whether this client's player may tap the map at all (the turn check is in mayOrder). */
	public static boolean canOrder( Hero hero ){
		if (hero == null) return false;
		return enabled ? hero.isAlive() : hero.ready;
	}

	/** True while a selector opened by an applied order waits for its answer through the log. */
	public static boolean promptParked(){
		return proxiedCellListener != null || proxiedItemSelector != null;
	}

	private static int epochOf( Action skip ){
		int colon = skip.payload.indexOf( ':' );
		try {
			return colon < 0 ? -1 : Integer.parseInt( skip.payload.substring( colon + 1 ) );
		} catch (NumberFormatException e) {
			return -1;
		}
	}

	//consumed entries and entries of dead heroes are skipped over
	private static void advanceCursor(){
		while (cursor < log.size()) {
			Action a = log.get( cursor );
			if (!a.consumed && a.hero < Dungeon.heroes.size() && Dungeon.heroes.get( a.hero ).isAlive()) break;
			a.consumed = true;
			cursor++;
		}
	}

	/**
	 * The decision for a hero at the start of its act(). Called on the actor thread only.
	 * Returns an entry to apply, or WAIT (park until the log grows), CONTINUE (carry on with
	 * the action in progress) or PASS (an idle hero lets a turn go by while others move).
	 * Every branch reads the log only at positions the simulation waits for, so all clients
	 * decide the same whatever the delivery timing.
	 */
	public static Action next( Hero hero ){
		int me = indexOf( hero );
		boolean busy = hero.isBusy();
		boolean strict = !busy && partySeesEnemy();
		synchronized (log) {
			while (true) {
				advanceCursor();
				if (!strict) {
					if (cursor >= log.size()) return park( me, false );
					Action a = log.get( cursor );
					if (a.hero != me) {
						waitingHero = -1;
						return busy ? CONTINUE : PASS;
					}
					a.consumed = true;
					if (dropSkip( hero, a, busy )) continue;
					waitingHero = -1;
					return a;
				} else {
					for (int i = cursor; i < log.size(); i++) {
						Action a = log.get( i );
						if (a.consumed || a.hero != me) continue;
						a.consumed = true;
						if (dropSkip( hero, a, false )) continue;
						waitingHero = -1;
						return a;
					}
					return park( me, true );
				}
			}
		}
	}

	/**
	 * A skip is dropped when its epoch is not the hero's (a late or duplicate entry), and when
	 * the hero is idle and its own client wrote it: that is a "carry on" tick written ahead for
	 * a walk, and the walk has ended since (its last step, or an enemy came into view and
	 * interrupted it). Applied, it would let the hero's turn pass, often right in front of the
	 * enemy that interrupted it. A skip written by another client is a deliberate one (an
	 * absent owner, the strict-turn timeout) and stands.
	 */
	private static boolean dropSkip( Hero hero, Action a, boolean busy ){
		if (!"skip".equals( a.type )) return false;
		if (epochOf( a ) != epoch( hero )) return true;
		if (busy || ownTicksPass) return false;
		boolean own = a.uid.equals( players.get( a.hero ) );
		if (own) Gdx.app.log( "coop", "dropped own tick seq=" + a.seq + " for idle hero " + a.hero
				+ (partySeesEnemy() ? " (enemy in sight)" : "") );
		return own;
	}

	private static Action park( int hero, boolean strict ){
		waitingHero = hero;
		waitingStrict = strict;
		return WAIT;
	}

	/** A paralysed hero cannot take orders: its entries at the front of the log are dropped. */
	public static void dropOrders( Hero hero ){
		int me = indexOf( hero );
		synchronized (log) {
			advanceCursor();
			while (cursor < log.size() && log.get( cursor ).hero == me) {
				log.get( cursor ).consumed = true;
				cursor++;
			}
		}
	}

	/** An idle hero lets a turn pass (PASS verdict). Counts like an applied entry. */
	public static void pass( Hero hero ){
		hero.pass();
		finishApply( hero, "pass", "" );
	}

	private static void finishApply( Hero hero, String type, String detail ){
		epochs.put( indexOf( hero ), epoch( hero ) + 1 );
		applies++;
		if (applies % CHECK_EVERY != 0) return;
		long sum = checksum();
		applied.put( (long) applies, sum );
		Gdx.app.log( "coop", "applied #" + applies + " " + type + " " + detail
				+ " hero=" + indexOf( hero ) + " checksum=" + Long.toHexString( sum ) + " " + checksumDetail() );
		Long expected = reported.remove( (long) applies );
		if (expected != null && expected != sum) flagDesync( applies );
		//the detail travels too, so a mismatch can be diagnosed from the room's log alone
		submit( "check", applies + ":" + Long.toHexString( sum ) + "|" + checksumDetail() );
	}

	/** Turns a log entry into hero state, exactly like local input would. */
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
				case "resume":
					hero.resume();
					result = hero.curAction != null;
					break;
				case "cancel":
					cancel( hero );
					result = true;
					break;
				case "wait":
					applyWait( hero );
					result = true;
					break;
				case "skip":
					//"nothing new": a busy hero carries on, an idle one lets the turn pass
					//(stale epochs were dropped by next())
					if (!hero.isBusy()) {
						hero.pass();
						Gdx.app.log( "coop", "turn passed by skip seq=" + action.seq + " hero=" + action.hero
								+ (action.uid.equals( players.get( action.hero ) ) ? " (own client)" : " (other client)")
								+ (partySeesEnemy() ? " enemy in sight" : "") );
					}
					result = true;
					break;
				default:
					GLog.w( "unknown co-op action: " + action.type );
			}
		} catch (NumberFormatException e) {
			result = false;
		} finally {
			applying = false;
			finishApply( hero, action.type, "seq=" + action.seq + " " + action.payload );
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
			int end = payload.indexOf( '|' );
			if (end < 0) end = payload.length();
			for (char c : payload.substring( colon + 1, end ).toCharArray()) {
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

	private static void flagDesync( long count ){
		if (desynced) return;
		desynced = true;
		Gdx.app.error( "coop", "desync detected at apply #" + count );
		GLog.n( "Out of sync with the other players (action " + count + "). Reload the page to catch up." );
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
