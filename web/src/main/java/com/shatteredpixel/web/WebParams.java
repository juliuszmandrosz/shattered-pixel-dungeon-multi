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

package com.shatteredpixel.web;

import org.teavm.jso.JSBody;

/**
 * Parameters the lobby passes to the game through the iframe URL:
 * room, player, seed, order (comma separated player ids), heroClass.
 *
 * Lives outside the game packages on purpose: those are registered for reflection in
 * web/build.gradle, and TeaVM cannot expose a @JSBody native method through reflection.
 */
public final class WebParams {

	private WebParams() {}

	@JSBody(params = {"name"}, script =
			"var v = new URLSearchParams(window.location.search).get(name);" +
			"return v === null ? null : v;")
	public static native String get(String name);

	public static String get(String name, String fallback) {
		String value = get(name);
		return value == null || value.isEmpty() ? fallback : value;
	}
}
