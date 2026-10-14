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
import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.g2d.PixmapPacker;
import com.badlogic.gdx.graphics.g2d.freetype.FreeTypeFontGenerator;
import com.watabou.utils.PlatformSupport;

import java.util.ArrayList;
import java.util.HashMap;

/**
 * Platform glue for the browser. Mirrors DesktopPlatformSupport minus the
 * things a browser tab cannot do (window sizing, fullscreen monitors).
 */
public class WebPlatformSupport extends PlatformSupport {

	@Override
	public void updateDisplaySize() {
		// the canvas follows the browser viewport, nothing to persist
	}

	@Override
	public boolean supportsFullScreen() {
		return false;
	}

	@Override
	public void updateSystemUI() {
		// no system UI to adjust in a browser tab
	}

	@Override
	public boolean connectedToUnmeteredNetwork() {
		return true;
	}

	@Override
	public boolean supportsVibration() {
		return false;
	}

	/* FONT SUPPORT */

	//custom pixel font, for use with Latin and Cyrillic languages
	private static FreeTypeFontGenerator basicFontGenerator;
	//droid sans fallback, for asian fonts
	private static FreeTypeFontGenerator asianFontGenerator;

	@Override
	public void setupFontGenerators(int pageSize, boolean systemfont) {
		//don't bother doing anything if nothing has changed
		if (fonts != null && this.pageSize == pageSize && this.systemfont == systemfont){
			return;
		}
		this.pageSize = pageSize;
		this.systemfont = systemfont;

		resetGenerators(false);
		fonts = new HashMap<>();

		if (systemfont) {
			basicFontGenerator = asianFontGenerator = new FreeTypeFontGenerator(Gdx.files.internal("fonts/droid_sans.ttf"));
		} else {
			basicFontGenerator = new FreeTypeFontGenerator(Gdx.files.internal("fonts/pixel_font.ttf"));
			asianFontGenerator = new FreeTypeFontGenerator(Gdx.files.internal("fonts/droid_sans.ttf"));
		}

		fonts.put(basicFontGenerator, new HashMap<>());
		fonts.put(asianFontGenerator, new HashMap<>());

		packer = new PixmapPacker(pageSize, pageSize, Pixmap.Format.RGBA8888, 1, false);
	}

	//TeaVM's regex engine does not support \p{InXxx} unicode block names, so the
	//desktop regex approach is replaced with explicit code point ranges. The ranges
	//match the blocks used by DesktopPlatformSupport: Hangul Syllables, CJK Unified
	//Ideographs, CJK Symbols and Punctuation, Halfwidth and Fullwidth Forms, Hiragana, Katakana.
	private static boolean isAsianChar( char c ){
		return (c >= 0xAC00 && c <= 0xD7AF)
				|| (c >= 0x4E00 && c <= 0x9FFF)
				|| (c >= 0x3000 && c <= 0x303F)
				|| (c >= 0xFF00 && c <= 0xFFEF)
				|| (c >= 0x3040 && c <= 0x309F)
				|| (c >= 0x30A0 && c <= 0x30FF);
	}

	//hangul and fullwidth forms are rendered by the asian font but do not need per-character splitting
	private static boolean splitsAroundChar( char c ){
		return (c >= 0x4E00 && c <= 0x9FFF)
				|| (c >= 0x3000 && c <= 0x303F)
				|| (c >= 0x3040 && c <= 0x309F)
				|| (c >= 0x30A0 && c <= 0x30FF);
	}

	@Override
	protected FreeTypeFontGenerator getGeneratorForString( String input ){
		for (int i = 0; i < input.length(); i++){
			if (isAsianChar(input.charAt(i))){
				return asianFontGenerator;
			}
		}
		return basicFontGenerator;
	}

	//splits on newline (for layout), chinese/japanese (for font choice), and '_'/'**' (for highlighting)
	//additionally splits on spaces when multiline, so that each word can be laid out individually
	@Override
	public String[] splitforTextBlock(String text, boolean multiline) {
		ArrayList<String> pieces = new ArrayList<>();
		StringBuilder current = new StringBuilder();

		for (int i = 0; i < text.length(); i++){
			char c = text.charAt(i);

			if (c == '*' && i + 1 < text.length() && text.charAt(i + 1) == '*'){
				flush(current, pieces);
				pieces.add("**");
				i++;
			} else if (c == '\n' || c == '_' || splitsAroundChar(c) || (multiline && c == ' ')){
				flush(current, pieces);
				pieces.add(String.valueOf(c));
			} else {
				current.append(c);
			}
		}
		flush(current, pieces);

		return pieces.toArray(new String[0]);
	}

	private static void flush( StringBuilder current, ArrayList<String> pieces ){
		if (current.length() > 0){
			pieces.add(current.toString());
			current.setLength(0);
		}
	}
}
