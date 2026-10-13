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
import com.shatteredpixel.shatteredpixeldungeon.actors.hero.HeroClass;
import com.shatteredpixel.shatteredpixeldungeon.scenes.InterlevelScene;
import com.shatteredpixel.shatteredpixeldungeon.ui.ActionIndicator;
import com.shatteredpixel.shatteredpixeldungeon.utils.DungeonSeed;
import com.shatteredpixel.web.WebParams;
import com.watabou.utils.PlatformSupport;

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

		// a reload of the tab resumes the run for this room instead of starting over
		for (int slot = 1; slot <= GamesInProgress.MAX_SLOTS; slot++) {
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
		int slot = GamesInProgress.firstEmpty();
		GamesInProgress.curSlot = slot == -1 ? 1 : slot;

		// Dungeon.initSeed reads the custom seed setting, same path as entering a seed by hand
		SPDSettings.customSeed(DungeonSeed.convertToCode(seed));
		Dungeon.initSeed();

		InterlevelScene.mode = InterlevelScene.Mode.DESCEND;
		switchNoFade(InterlevelScene.class);
	}
}
