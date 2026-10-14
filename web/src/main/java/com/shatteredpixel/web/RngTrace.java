package com.shatteredpixel.web;

import org.teavm.jso.JSBody;

/** Debug helper: logs the JS stack of simulation RNG draws (see the rngtrace launch parameter). */
public class RngTrace {

	@JSBody(params = {"tag"}, script = "console.log(tag + \"\\n\" + new Error().stack);")
	public static native void log(String tag);

}
