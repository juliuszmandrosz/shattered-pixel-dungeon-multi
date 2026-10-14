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

package com.shatteredpixel.shatteredpixeldungeon.web;

import com.badlogic.gdx.Gdx;
import com.shatteredpixel.shatteredpixeldungeon.Badges;
import com.shatteredpixel.shatteredpixeldungeon.Dungeon;
import com.shatteredpixel.shatteredpixeldungeon.GamesInProgress;
import com.shatteredpixel.shatteredpixeldungeon.SPDSettings;
import com.shatteredpixel.shatteredpixeldungeon.ShatteredPixelDungeon;
import com.shatteredpixel.shatteredpixeldungeon.actors.Actor;
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.HeroClass;
import com.shatteredpixel.shatteredpixeldungeon.scenes.GameScene;
import com.shatteredpixel.shatteredpixeldungeon.scenes.InterlevelScene;
import com.shatteredpixel.shatteredpixeldungeon.ui.ActionIndicator;
import com.shatteredpixel.shatteredpixeldungeon.utils.DungeonSeed;
import com.shatteredpixel.shatteredpixeldungeon.coop.Coop;
import com.shatteredpixel.web.CoopNet;
import com.shatteredpixel.web.WebParams;

import java.util.Arrays;
import com.watabou.noosa.Game;
import com.watabou.utils.PlatformSupport;

import java.io.IOException;

/**
 * Browser variant of the game. When the lobby opens it with room parameters in the URL
 * it skips the welcome, title and hero selection screens and goes straight into a run
 * with the room's seed and the hero class picked in the lobby.
 */
public class WebShatteredPixelDungeon extends ShatteredPixelDungeon {

	public WebShatteredPixelDungeon(PlatformSupport platform) {
		super(platform);
	}

	@Override
	public void create() {
		super.create();
		Gdx.app.log("web", "create: game created");

		try {
			unlockAllClasses();
			Gdx.app.log("web", "create: classes unlocked");

			if (!WebParams.get("rngtrace", "").isEmpty()) {
				//only draws made by the actor thread, level generation is too noisy
				com.watabou.utils.Random.trace = () -> {
					if (com.shatteredpixel.shatteredpixeldungeon.actors.Actor.simulating) {
						com.shatteredpixel.web.RngTrace.log("rngtrace " + com.shatteredpixel.shatteredpixeldungeon.coop.Coop.localPlayer);
					}
				};
			}
			String seedParam = WebParams.get("seed");
			Gdx.app.log("web", "create: seed param = " + seedParam);
			if (seedParam != null && !seedParam.isEmpty()) {
				startRoomGame(seedParam, WebParams.get("heroClass", "WARRIOR"));
				Gdx.app.log("web", "create: room game requested");
			}
		} catch (Throwable t) {
			Gdx.app.error("web", "create failed", t);
		}
	}

	private static final long AUTOSAVE_INTERVAL_MS = 5000;
	private long nextAutosave = 0;
	private float savedAt = -1;

	@Override
	public void render() {
		super.render();

		// browsers may cut the save that onPause starts when the tab closes, so outside co-op rooms
		// (whose state is the action log) the run is saved every few seconds while idle
		if (Coop.enabled || !(Game.scene() instanceof GameScene) || Dungeon.hero == null) return;
		if (!Dungeon.hero.ready || Actor.processing() || Actor.now() == savedAt) return;
		if (Game.realTime < nextAutosave) return;
		nextAutosave = Game.realTime + AUTOSAVE_INTERVAL_MS;
		try {
			Dungeon.saveAll();
			savedAt = Actor.now();
		} catch (IOException e) {
			reportException(e);
		}
	}

	// every hero is available in the lobby, the unlock badges exist for the single player progression
	private static void unlockAllClasses() {
		Gdx.app.log("web", "unlock: loading badges");
		Badges.loadGlobal();
		Gdx.app.log("web", "unlock: badges loaded");
		Badges.Badge[] unlocks = {
				Badges.Badge.UNLOCK_MAGE, Badges.Badge.UNLOCK_ROGUE, Badges.Badge.UNLOCK_HUNTRESS,
				Badges.Badge.UNLOCK_DUELIST, Badges.Badge.UNLOCK_CLERIC
		};
		boolean changed = false;
		for (Badges.Badge badge : unlocks) {
			if (!Badges.isUnlocked(badge)) {
				Badges.unlock(badge);
				changed = true;
			}
		}
		Gdx.app.log("web", "unlock: changed = " + changed);
		if (changed) Badges.saveGlobal();
		Gdx.app.log("web", "unlock: saved");
	}

	private static void startRoomGame(String seedParam, String heroClassName) {
		long seed;
		try {
			seed = Long.parseLong(seedParam);
		} catch (NumberFormatException e) {
			return;
		}

		// no welcome screen or tutorial prompt, the lobby already did the introductions
		SPDSettings.intro(false);
		SPDSettings.version(ShatteredPixelDungeon.versionCode);

		Dungeon.hero = null;
		Dungeon.daily = Dungeon.dailyReplay = false;
		ActionIndicator.clearAction();

		// a co-op room never resumes a local save: the room's action log in the database is the
		// state. The game starts fresh and replays the log, which also covers joining late and
		// catching up after a desync (reload the page).
		boolean coopRoom = !WebParams.get("room", "").isEmpty() && !WebParams.get("order", "").isEmpty();

		// a reload of the tab resumes the run for this room instead of starting over
		for (int slot = 1; !coopRoom && slot <= GamesInProgress.MAX_SLOTS; slot++) {
			GamesInProgress.Info info = GamesInProgress.check(slot);
			if (info != null && info.seed == seed) {
				GamesInProgress.curSlot = slot;
				InterlevelScene.mode = InterlevelScene.Mode.CONTINUE;
				switchNoFade(InterlevelScene.class);
				return;
			}
		}

		HeroClass heroClass;
		try {
			heroClass = HeroClass.valueOf(heroClassName);
		} catch (IllegalArgumentException e) {
			heroClass = HeroClass.WARRIOR;
		}

		GamesInProgress.selectedClass = heroClass;
		GamesInProgress.randomizedClass = false;

		//the whole party in player order, e.g. party=WARRIOR,MAGE; the first entry is this client's hero
		//for now (hot-seat), the lobby passes every member's class and the game creates them all
		Dungeon.partyClasses.clear();
		String party = WebParams.get("party", "");
		if (!party.isEmpty()) {
			for (String name : party.split(",")) {
				try {
					Dungeon.partyClasses.add(HeroClass.valueOf(name.trim()));
				} catch (IllegalArgumentException e) {
					Gdx.app.log("web", "unknown hero class in party: " + name);
				}
			}
		}
		//co-op: the party keeps the lobby's player order on every client, the first entry is
		//whoever is first in that order, not necessarily this client's hero
		String room = WebParams.get("room", "");
		String player = WebParams.get("player", "");
		String order = WebParams.get("order", "");
		//a room with a single player still runs through the relay, so the whole path is exercised
		if (!room.isEmpty() && !player.isEmpty() && !order.isEmpty()) {
			Coop.reset();
			Coop.enabled = true;
			Coop.localPlayer = player;
			Coop.players.addAll(Arrays.asList(order.split(",")));
			//display names in player order (optional, for in-game messages)
			String names = WebParams.get("names", "");
			if (!names.isEmpty()) Coop.names.addAll(Arrays.asList(names.split(",")));
			Coop.ownTicksPass = "1".equals(WebParams.get("legacyticks", ""));
			Coop.transport = CoopNet::send;
			CoopNet.listen(Coop::receive);
			CoopNet.send("{\"spd\":\"ready\"}");
			Dungeon.localHeroIndex = Math.max(0, Coop.localIndex());
			if (Dungeon.partyClasses.isEmpty()) Dungeon.partyClasses.add(heroClass);
			GamesInProgress.selectedClass = Dungeon.partyClasses.get(0);
			Gdx.app.log("web", "co-op room " + room + ", player " + player + " is hero #" + Dungeon.localHeroIndex + " of " + Coop.players.size());
		} else {
			//hot-seat or single player: this client's hero goes first
			Dungeon.localHeroIndex = -1;
			if (Dungeon.partyClasses.isEmpty() || Dungeon.partyClasses.get(0) != heroClass) {
				Dungeon.partyClasses.remove(heroClass);
				Dungeon.partyClasses.add(0, heroClass);
			}
		}
		int slot = GamesInProgress.firstEmpty();
		GamesInProgress.curSlot = slot == -1 ? 1 : slot;

		// Dungeon.initSeed reads the custom seed setting, same path as entering a seed by hand
		SPDSettings.customSeed(DungeonSeed.convertToCode(seed));
		Dungeon.initSeed();

		InterlevelScene.mode = InterlevelScene.Mode.DESCEND;
		switchNoFade(InterlevelScene.class);
	}
}
