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
import org.teavm.jso.JSFunctor;
import org.teavm.jso.JSObject;

/**
 * Bridge between the game and the page that hosts it. The page owns the network connection;
 * the game only exchanges postMessage events with its parent window:
 *   game -> page   {spd:"action", type, payload}
 *   page -> game   {spd:"action", id, uid, seq, type, payload, at}
 * Incoming messages are flattened to "uid TAB seq TAB type TAB payload" for the Java side.
 *
 * Lives outside the reflected game packages, see WebParams.
 */
public final class CoopNet {

	private CoopNet() {}

	@JSFunctor
	public interface Handler extends JSObject {
		void handle( String flat );
	}

	@JSBody(params = {"handler"}, script =
			"window.addEventListener('message', function (e) {" +
			"  var d = e.data;" +
			"  if (!d || d.spd !== 'action' || d.uid === undefined || d.seq === undefined) return;" +
			"  var payload = d.payload === null || d.payload === undefined ? '' : String(d.payload);" +
			"  handler(String(d.uid) + '\\t' + String(d.seq) + '\\t' + String(d.type) + '\\t' + payload);" +
			"});")
	public static native void listen( Handler handler );

	@JSBody(params = {"json"}, script =
			"var target = window.parent === window ? window : window.parent;" +
			"target.postMessage(JSON.parse(json), window.location.origin);")
	public static native void send( String json );
}
