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

import com.badlogic.gdx.Files;
import com.github.xpenatan.gdx.teavm.backends.web.WebApplication;
import com.github.xpenatan.gdx.teavm.backends.web.WebApplicationConfiguration;
import com.shatteredpixel.web.WebParams;
import com.watabou.noosa.Game;
import com.watabou.utils.FileUtils;

/**
 * Browser entry point. Compiled to JavaScript by TeaVM (see web/build.gradle).
 * Version name and code are passed in as program arguments from the Gradle build.
 */
public class WebLauncher {

	private static final String DEFAULT_VERSION = "4.0.2";
	private static final int DEFAULT_VERSION_CODE = 922;

	public static void main (String[] args) {

		Game.version = args.length > 0 ? args[0] : DEFAULT_VERSION;
		try {
			Game.versionCode = args.length > 1 ? Integer.parseInt(args[1]) : DEFAULT_VERSION_CODE;
		} catch (NumberFormatException e) {
			Game.versionCode = DEFAULT_VERSION_CODE;
		}
		Game.version += "-WEB";

		// Saves and preferences live in the browser's local storage, namespaced by this prefix.
		String player = WebParams.get("player", "");
		FileUtils.setDefaultFileProperties(Files.FileType.Local,
				"shattered-pixel-dungeon/" + (player.isEmpty() ? "" : player + "/"));

		WebApplicationConfiguration config = new WebApplicationConfiguration("canvas");
		// 0 = fill the browser viewport and follow resizes
		config.width = 0;
		config.height = 0;
		config.storagePrefix = "shattered-pixel-dungeon";
		config.preloadListener = assetLoader -> assetLoader.loadScript("freetype.js");

		new WebApplication(new WebShatteredPixelDungeon(new WebPlatformSupport()), config);
	}
}
