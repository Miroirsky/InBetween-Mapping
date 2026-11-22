/**
 * Noise Configuration Values
 * ------------------------------------------------------------------
 * All accessible parameters for the Perlin noise background are defined here.
 * You can edit these values directly in this file to customize the noise behavior.
 */

const NoiseConfig = {
    /**
     * Noise Size (Scale)
     * Controls the frequency/zoom of the noise pattern.
     * - Smaller values (e.g. 1.0 - 2.0) = large, broad patterns
     * - Larger values (e.g. 5.0 - 10.0) = smaller, denser details
     */
    noiseSize: 1.0,

    /**
     * Noise Speed
     * Controls the animation rate of the noise over time.
     * - 0.0 = static / frozen
     * - 0.1 - 0.5 = smooth, gentle morphing
     * - 1.0+ = rapid evolution
     */
    noiseSpeed: 0.01,

    /**
     * Steps (Number of distinct grayscale shades)
     * Quantizes the black-and-white gradient into discrete steps.
     * - 10 = exactly 10 distinct shades from pure black to pure white
     * - 2 = pure black & white threshold (duotone)
     * - 0 or 1 = smooth continuous gradient (no stepping)
     */
    steps: 15,

    /**
     * Fractal Octaves (Detail layers)
     * - 1 = classic single-layer Perlin noise
     * - 2 to 4 = richer fractal noise with finer sub-harmonics
     */
    octaves: 2,

    /**
     * Invert Colors
     * - false = dark lows, white highs
     * - true  = white lows, dark highs
     */
    invert: false,

    /**
     * Maintain Square Aspect Ratio
     * Keeps noise features proportional without stretching when window resizes.
     */
    maintainAspectRatio: true,

    /**
     * Background Noise Colors (Gradient from low noise values to high noise values)
     * - colorLow: color for dark/low noise bands (default pure black)
     * - colorHigh: color for light/high noise bands (default pure white)
     */
    colorLow: '#000000',
    colorHigh: '#ffffff'
};

// Expose to window for global browser access without bundling required
if (typeof window !== 'undefined') {
    window.NoiseConfig = NoiseConfig;
}

// Support ES/CommonJS modules if imported
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NoiseConfig;
}
