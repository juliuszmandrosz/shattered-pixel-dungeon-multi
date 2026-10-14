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

package com.watabou.utils;

import com.watabou.noosa.Game;

import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;

public class Random {

	/**
	 * Generator with an explicit, readable state so the simulation's randomness can be
	 * seeded identically on every co-op client, saved, and restored. SplitMix64 drives the
	 * state, outputs satisfy java.util.Random's next(bits) contract.
	 */
	public static class SeededGenerator extends java.util.Random {
		private long state;

		public SeededGenerator( long seed ) {
			super( 0 );
			state = seed;
		}

		public synchronized long state() { return state; }
		public synchronized void state( long value ) { state = value; }

		@Override
		protected int next( int bits ) {
			long z = (state += 0x9E3779B97F4A7C15L);
			z = (z ^ (z >>> 30)) * 0xBF58476D1CE4E5B9L;
			z = (z ^ (z >>> 27)) * 0x94D049BB133111EBL;
			z = z ^ (z >>> 31);
			return (int)(z >>> (64 - bits));
		}
	}

	/** Decides whether a call outside any pushed generator belongs to visuals rather than the simulation. */
	public interface Gate {
		boolean visual();
	}

	//we store a stack of random number generators, which may be seeded deliberately or randomly.
	//top of the stack is what is currently being used to generate new numbers.
	//the base generator is the simulation generator and cannot be popped.
	private static ArrayDeque<java.util.Random> generators;
	private static SeededGenerator simulation;
	//particles, UI and other render-side callers must not consume simulation randomness,
	//otherwise co-op clients with different frame rates diverge. The gate is installed by the game.
	private static final java.util.Random visual = new java.util.Random();
	private static Gate gate = null;
	/** Debug hook: called for every draw that hits the simulation generator. */
	public interface TraceHook {
		void draw();
	}
	public static TraceHook trace = null;
	static {
		resetGenerators();
	}

	public static synchronized void resetGenerators(){
		generators = new ArrayDeque<>();
		simulation = new SeededGenerator( scrambleSeed( System.nanoTime() ^ visual.nextLong() ) );
		generators.push( simulation );
	}

	public static synchronized void setGate( Gate g ){
		gate = g;
	}

	/** Seeds the simulation generator deterministically, used at the start of a run. */
	public static synchronized void seedSimulation( long seed ){
		simulation.state( scrambleSeed( seed ) );
	}

	public static synchronized long simulationState(){
		return simulation.state();
	}

	public static synchronized void restoreSimulationState( long state ){
		simulation.state( state );
	}

	//the generator the caller should use: a pushed one, or the simulation/visual base
	private static java.util.Random current(){
		java.util.Random top = generators.peekFirst();
		if (top == simulation && gate != null && gate.visual()) {
			return visual;
		}
		if (top == simulation && trace != null) trace.draw();
		return top;
	}

	public static synchronized void pushGenerator(){
		generators.push( new java.util.Random() );
	}

	public static synchronized void pushGenerator( long seed ){
		generators.push( new java.util.Random( scrambleSeed(seed) ) );
	}

	//scrambles a given seed, this helps eliminate patterns between the outputs of similar seeds
	//Algorithm used is MX3 by Jon Maiga (jonkagstrom.com), CC0 license.
	private static synchronized long scrambleSeed( long seed ){
		seed ^= seed >>> 32;
		seed *= 0xbea225f9eb34556dL;
		seed ^= seed >>> 29;
		seed *= 0xbea225f9eb34556dL;
		seed ^= seed >>> 32;
		seed *= 0xbea225f9eb34556dL;
		seed ^= seed >>> 29;
		return seed;
	}

	public static synchronized void popGenerator(){
		if (generators.size() == 1){
			Game.reportException( new RuntimeException("tried to pop the last random number generator!"));
		} else {
			generators.pop();
		}
	}

	//returns a uniformly distributed float in the range [0, 1)
	public static synchronized float Float() {
		return Float(true);
	}

	public static synchronized float Float( boolean useGeneratorStack ) {
		if (useGeneratorStack)  return current().nextFloat();
		else                    return visual.nextFloat();
	}

	//returns a uniformly distributed float in the range [0, max)
	public static float Float( float max ) {
		return Float() * max;
	}

	//returns a uniformly distributed float in the range [min, max)
	public static float Float( float min, float max ) {
		return min + Float(max - min);
	}
	
	//returns a triangularly distributed float in the range [min, max)
	public static float NormalFloat( float min, float max ) {
		return min + ((Float(max - min) + Float(max - min))/2f);
	}

	//returns a uniformly distributed int in the range [-2^31, 2^31)
	public static synchronized int Int() {
		return Int(true);
	}

	//returns a uniformly distributed int in the range [-2^31, 2^31)
	//can either use the current generator in the stack, or force the first generator (pure random)
	public static synchronized int Int( boolean useGeneratorStack ) {
		if (useGeneratorStack)  return current().nextInt();
		else                    return visual.nextInt();
	}

	//returns a uniformly distributed int in the range [0, max)
	public static synchronized int Int( int max ) {
		return Int(max, true);
	}

	//returns a uniformly distributed int in the range [0, max)
	//can either use the current generator in the stack, or force the first generator (pure random)
	public static synchronized int Int( int max, boolean useGeneratorStack ) {
		if (max <= 0)                   return 0;
		else if (useGeneratorStack)     return current().nextInt(max);
		else                            return visual.nextInt(max);
	}

	//returns a uniformly distributed int in the range [min, max)
	public static int Int( int min, int max ) {
		return min + Int(max - min);
	}

	//returns a uniformly distributed int in the range [min, max]
	public static int IntRange( int min, int max ) {
		return min + Int(max - min + 1);
	}

	//returns a triangularly distributed int in the range [min, max]
	//this makes results more likely as they get closer to the middle of the range
	public static int NormalIntRange( int min, int max ) {
		return min + (int)((Float() + Float()) * (max - min + 1) / 2f);
	}

	//returns an inverse triangularly distributed int in the range [min, max]
	//this makes results more likely as they get further from the middle of the range
	public static int InvNormalIntRange( int min, int max ){
		float roll1 = Float(), roll2 = Float();
		if (Math.abs(roll1-0.5f) >= Math.abs(roll2-0.5f)){
			return min + (int)(roll1*(max - min + 1));
		} else {
			return min + (int)(roll2*(max - min + 1));
		}
	}

	//returns a uniformly distributed long in the range [-2^63, 2^63)
	public static synchronized long Long() {
		return Long(true);
	}

	//returns a uniformly distributed long in the range [-2^63, 2^63)
	//can either use the current generator in the stack, or force the first generator (pure random)
	public static synchronized long Long( boolean useGeneratorStack ) {
		if (useGeneratorStack)  return current().nextLong();
		else                    return visual.nextLong();
	}

	//returns a mostly uniformly distributed long in the range [0, max)
	public static long Long( long max ) {
		long result = Long();
		if (result < 0) result += Long.MAX_VALUE;
		//modulo isn't perfect, but as long as max is reasonably below 2^63 it's close enough
		return result % max;
	}

	//returns an index from chances, the probability of each index is the weight values in changes
	//negative values are treated as 0
	public static int chances( float[] chances ) {
		
		int length = chances.length;
		
		float sum = 0;
		for (int i=0; i < length; i++) {
			sum += Math.max(0, chances[i]);
		}

		if (sum <= 0){
			return -1;
		}
		
		float value = Float( sum );
		sum = 0;
		for (int i=0; i < length; i++) {
			sum += Math.max(0, chances[i]);
			if (value < sum) {
				return i;
			}
		}
		
		return -1;
	}
	
	@SuppressWarnings("unchecked")
	//returns a key element from chances, the probability of each key is the weight value it maps to
	public static <K> K chances( HashMap<K,Float> chances ) {
		
		int size = chances.size();

		Object[] values = chances.keySet().toArray();
		float[] probs = new float[size];
		float sum = 0;
		for (int i=0; i < size; i++) {
			probs[i] = chances.get( values[i] );
			sum += probs[i];
		}
		
		if (sum <= 0) {
			return null;
		}
		
		float value = Float( sum );
		
		sum = probs[0];
		for (int i=0; i < size; i++) {
			if (value < sum) {
				return (K)values[i];
			}
			sum += probs[i + 1];
		}
		
		return null;
	}
	
	public static int index( Collection<?> collection ) {
		return Int(collection.size());
	}

	@SafeVarargs
	public static<T> T oneOf(T... array ) {
		return array[Int(array.length)];
	}
	
	public static<T> T element( T[] array ) {
		return element( array, array.length );
	}
	
	public static<T> T element( T[] array, int max ) {
		return array[Int(max)];
	}
	
	@SuppressWarnings("unchecked")
	public static<T> T element( Collection<? extends T> collection ) {
		int size = collection.size();
		return size > 0 ?
			(T)collection.toArray()[Int( size )] :
			null;
	}

	public synchronized static<T> void shuffle( List<?extends T> list){
		Collections.shuffle(list, current());
	}

	public static void shuffle( int[] array ) {
		for (int i=0; i < array.length - 1; i++) {
			int j = Int( i, array.length );
			if (j != i) {
				int t = array[i];
				array[i] = array[j];
				array[j] = t;
			}
		}
	}

	public static<T> void shuffle( T[] array ) {
		for (int i=0; i < array.length - 1; i++) {
			int j = Int( i, array.length );
			if (j != i) {
				T t = array[i];
				array[i] = array[j];
				array[j] = t;
			}
		}
	}
	
	public static<U,V> void shuffle( U[] u, V[]v ) {
		for (int i=0; i < u.length - 1; i++) {
			int j = Int( i, u.length );
			if (j != i) {
				U ut = u[i];
				u[i] = u[j];
				u[j] = ut;
				
				V vt = v[i];
				v[i] = v[j];
				v[j] = vt;
			}
		}
	}
}
