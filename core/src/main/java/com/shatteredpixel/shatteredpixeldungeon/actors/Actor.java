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

package com.shatteredpixel.shatteredpixeldungeon.actors;

import com.shatteredpixel.shatteredpixeldungeon.Dungeon;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.Hero;
import com.shatteredpixel.shatteredpixeldungeon.Statistics;
import com.shatteredpixel.shatteredpixeldungeon.actors.blobs.Blob;
import com.shatteredpixel.shatteredpixeldungeon.actors.buffs.Buff;
import com.shatteredpixel.shatteredpixeldungeon.actors.mobs.Mob;
import com.shatteredpixel.shatteredpixeldungeon.effects.TargetedCell;
import com.watabou.noosa.Game;
import com.watabou.utils.Bundlable;
import com.watabou.utils.Bundle;
import com.watabou.utils.SparseArray;

import java.util.HashSet;
import java.util.LinkedHashSet;

public abstract class Actor implements Bundlable {
	
	public static final float TICK	= 1f;

	private float time;

	private int id = 0;

	//default priority values for general actor categories
	//note that some specific actors pick more specific values
	//e.g. a buff acting before all normal buffs might have priority BUFF_PRIO + 1
	protected static final int VFX_PRIO    = 100;   //visual effects take priority
	protected static final int HERO_PRIO   = 0;     //positive is before hero, negative after
	protected static final int BLOB_PRIO   = -10;   //blobs act after hero, before mobs
	protected static final int MOB_PRIO    = -20;   //mobs act between buffs and blobs
	protected static final int BUFF_PRIO   = -30;   //buffs act last in a turn
	private static final int   DEFAULT     = -100;  //if no priority is given, act after all else

	//used to determine what order actors act in if their time is equal. Higher values act earlier.
	protected int actPriority = DEFAULT;

	protected abstract boolean act();

	//Always spends exactly the specified amount of time, regardless of time-influencing factors
	protected void spendConstant( float time ){
		this.time += time;
		//if time is very close to a whole number, round to a whole number to fix errors
		float ex = Math.abs(this.time % 1f);
		if (ex < .001f){
			this.time = Math.round(this.time);
		}
	}

	//sends time, but the amount can be influenced
	protected void spend( float time ) {
		spendConstant( time );
	}

	public void spendToWhole(){
		time = (float)Math.ceil(time);
	}
	
	protected void postpone( float time ) {
		if (this.time < now + time) {
			this.time = now + time;
			//if time is very close to a whole number, round to a whole number to fix errors
			float ex = Math.abs(this.time % 1f);
			if (ex < .001f){
				this.time = Math.round(this.time);
			}
		}
	}
	
	public float cooldown() {
		return time - now;
	}

	public void clearTime() {
		spendConstant(-Actor.now());
		if (this instanceof Char){
			for (Buff b : ((Char) this).buffs()){
				b.spendConstant(-Actor.now());
			}
		}
	}

	public void timeToNow() {
		time = now;
	}

	//used when now is being cleared as a part of static fixTime()
	public void fixTime(float decrement){
		time -= decrement;
	}
	
	protected void diactivate() {
		time = Float.MAX_VALUE;
	}
	
	protected void onAdd() {}
	
	protected void onRemove() {}

	private static final String TIME    = "time";
	private static final String ID      = "id";

	@Override
	public void storeInBundle( Bundle bundle ) {
		bundle.put( TIME, time );
		bundle.put( ID, id );
	}

	@Override
	public void restoreFromBundle( Bundle bundle ) {
		time = bundle.getFloat( TIME );
		int incomingID = bundle.getInt( ID );
		if (Actor.findById(incomingID) == null){
			id = incomingID;
		} else {
			id = nextID++;
		}
	}

	public int id() {
		if (id > 0) {
			return id;
		} else {
			return (id = nextID++);
		}
	}

	// **********************
	// *** Static members ***
	// **********************
	
	//insertion ordered: iteration order must be identical on every co-op client,
	//a plain HashSet orders by identity hash which differs between runs
	private static HashSet<Actor> all = new LinkedHashSet<>();
	private static HashSet<Char> chars = new LinkedHashSet<>();
	private static volatile Actor current;

	private static SparseArray<Actor> ids = new SparseArray<>();
	private static int nextID = 1;

	private static float now = 0;
	
	public static float now(){
		return now;
	}
	
	public static synchronized void clear() {
		
		now = 0;

		all.clear();
		chars.clear();

		ids.clear();
	}

	public static synchronized void fixTime() {
		
		if (all.isEmpty()) return;
		
		float min = Float.MAX_VALUE;
		for (Actor a : all) {
			if (a.time < min) {
				min = a.time;
			}
		}

		//Only pull everything back by whole numbers
		//So that turns always align with a whole number
		min = (int)min;
		for (Actor a : all) {
			a.fixTime(min);
		}
		TargetedCell.fixTime(min);

		if (Dungeon.hero != null && all.contains( Dungeon.hero )) {
			Statistics.duration += min;
		}
		now -= min;
	}
	
	public static void init() {
		
		add( Dungeon.hero );
		for (com.shatteredpixel.shatteredpixeldungeon.actors.hero.Hero h : Dungeon.heroes) {
			if (h != Dungeon.hero && h.isAlive()) add( h );
		}
		
		for (Mob mob : Dungeon.level.mobs) {
			add( mob );
		}

		//mobs need to remember their targets after every actor is added
		for (Mob mob : Dungeon.level.mobs) {
			mob.restoreEnemy();
		}
		
		for (Blob blob : Dungeon.level.blobs.values()) {
			add( blob );
		}
		
		current = null;
	}

	private static final String NEXTID = "nextid";

	public static void storeNextID( Bundle bundle){
		bundle.put( NEXTID, nextID );
	}

	public static void restoreNextID( Bundle bundle){
		nextID = bundle.getInt( NEXTID );
	}

	public static void resetNextID(){
		nextID = 1;
	}

	/*protected*/public void next() {
		if (current == this) {
			current = null;
		}
	}

	public static boolean processing(){
		return current != null;
	}

	/** The actor whose turn is being processed (parked in act() or acting), or null. */
	public static Actor current(){
		return current;
	}

	public static int curActorPriority() {
		return current != null ? current.actPriority : HERO_PRIO;
	}
	
	public static boolean keepActorThreadAlive = true;

	//true while the actor thread is running simulation code. It is cleared around the two points
	//where the thread blocks, because on the web (green threads) the render thread runs in between
	//and its particles must not consume simulation randomness. Thread identity is not reliable there.
	public static volatile boolean simulating = false;

	/**
	 * Runs game logic triggered by a finished animation (the render thread: attack and operate
	 * callbacks, missiles landing, knockback) as part of the simulation. The actor thread is
	 * parked meanwhile and these callbacks roll damage and more, so their random draws must come
	 * from the simulation generator, identically on every co-op client.
	 */
	public static void simulate( com.watabou.utils.Callback callback ){
		boolean was = simulating;
		simulating = true;
		try {
			callback.call();
		} finally {
			simulating = was;
		}
	}
	
	public static void process() {
		
		boolean doNext;
		boolean interrupted = false;
		simulating = true;
		//captured once: on the web Thread.currentThread() is not stable across green-thread
		//switches, and the monitor used for wait/notify must be the same object every time
		final Thread self = Thread.currentThread();

		try {
		do {
			
			current = null;
			if (!interrupted && !Game.switchingScene()) {
				float earliest = Float.MAX_VALUE;

				synchronized (Actor.class) {
					for (Actor actor : all) {

						//some actors will always go before others if time is equal.
						//ties on priority are broken by id so the choice never depends on iteration order
						if (actor.time < earliest ||
								actor.time == earliest && (current == null
										|| actor.actPriority > current.actPriority
										|| (actor.actPriority == current.actPriority && actor.id() < current.id()))) {
							earliest = actor.time;
							current = actor;
						}

					}
				}
			}

			if  (current != null) {

				now = current.time;
				Actor acting = current;

				if (acting instanceof Char && ((Char) acting).sprite != null) {
					// If it's character's turn to act, but its sprite
					// is moving, wait till the movement is over
					try {
						synchronized (((Char)acting).sprite) {
							//timed wait: a lost notify (seen on the web backend) then costs 50ms, not a hang
							while (((Char)acting).sprite.isMoving) {
								Dungeon.unfocusHero();
								simulating = false;
								((Char) acting).sprite.wait(50);
								simulating = true;
							}
						}
					} catch (InterruptedException e) {
						simulating = true;
						interrupted = true;
					} catch (IllegalMonitorStateException e) {
						simulating = true;
						System.err.println("coop: sprite wait without monitor");
					}
				}
				
				interrupted = interrupted || Thread.interrupted();
				
				if (interrupted){
					doNext = false;
					current = null;
				} else {
					//"Dungeon.hero" must be the same on every co-op client while simulation code runs
					Dungeon.focusHero( acting );
					doNext = acting.act();
					if (doNext && (Dungeon.hero == null || !Dungeon.hero.isAlive())) {
						doNext = false;
						current = null;
					}
				}
			} else {
				doNext = false;
			}

			if (!doNext){
				synchronized (self) {
					
					interrupted = interrupted || Thread.interrupted();
					
					if (interrupted){
						current = null;
						interrupted = false;
					}

					//signals to the gamescene that actor processing is finished for now
					try {
						self.notify();
					} catch (IllegalMonitorStateException e) {
						System.err.println("coop: actor notify without monitor");
					}
					
					//timed wait so a lost notify (web backend) cannot hang the run. The scene only
					//notifies once current is null (next() was called), so after a timeout we keep
					//waiting while an actor is still waiting for input: acting again would reset
					//selectors the actor may have opened.
					Dungeon.unfocusHero();
					simulating = false;
					do {
						try {
							self.wait(100);
						} catch (InterruptedException e) {
							interrupted = true;
						} catch (IllegalMonitorStateException e) {
							System.err.println("coop: actor wait without monitor");
							try {
								Thread.sleep(16);
							} catch (InterruptedException ie) {
								interrupted = true;
							}
						}
					} while (current != null && !interrupted && keepActorThreadAlive && !Thread.interrupted());
					simulating = true;
				}
			}

		} while (keepActorThreadAlive);
		} finally {
			//whatever ends this thread (interrupt, an exception), the render side must not keep
			//drawing from the simulation generator
			Dungeon.unfocusHero();
			simulating = false;
		}
	}
	
	public static void add( Actor actor ) {
		add( actor, now );
	}
	
	public static void addDelayed( Actor actor, float delay ) {
		add( actor, now + Math.max(delay, 0) );
	}
	
	private static synchronized void add( Actor actor, float time ) {
		
		if (all.contains( actor )) {
			return;
		}

		ids.put( actor.id(),  actor );

		all.add( actor );
		actor.time += time;
		actor.onAdd();
		
		if (actor instanceof Char) {
			Char ch = (Char)actor;
			chars.add( ch );
			for (Buff buff : ch.buffs()) {
				add(buff);
			}
		}
	}
	
	public static synchronized void remove( Actor actor ) {
		
		if (actor != null) {
			all.remove( actor );
			chars.remove( actor );
			actor.onRemove();

			if (actor.id > 0) {
				ids.remove( actor.id );
			}
		}
	}

	//'freezes' a character in time for a specified amount of time
	//USE CAREFULLY! Manipulating time like this is useful for some gameplay effects but is tricky
	public static void delayChar( Char ch, float time ){
		ch.spendConstant(time);
		for (Buff b : ch.buffs()){
			b.spendConstant(time);
		}
	}
	
	public static synchronized Char findChar( int pos ) {
		for (Char ch : chars){
			if (ch.pos == pos)
				return ch;
		}
		return null;
	}

	public static synchronized Actor findById( int id ) {
		return ids.get( id );
	}

	public static synchronized HashSet<Actor> all() {
		return new LinkedHashSet<>(all);
	}

	public static synchronized HashSet<Char> chars() { return new LinkedHashSet<>(chars); }
}
