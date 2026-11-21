/**
 * Perlin Shader Definitions
 * ------------------------------------------------------------------
 * Contains GLSL shader source code for rendering stepped 3D Perlin/Simplex noise.
 */

const PerlinShader = {
    vertexShaderSource: `
        attribute vec2 a_position;
        void main() {
            // Full-screen quad spanning [-1, 1]
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `,

    fragmentShaderSource: `
        precision highp float;

        uniform vec2  u_resolution;
        uniform float u_time;
        uniform float u_noiseSize;
        uniform float u_noiseSpeed;
        uniform float u_steps;
        uniform int   u_octaves;
        uniform bool  u_invert;
        uniform bool  u_aspect;
        uniform vec2  u_pan;
        uniform float u_zoom;

        // --- 3D Simplex Noise by Ian McEwan, Ashima Arts (Public Domain) ---
        vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
        vec4 taylorInvSqrt(vec4 r) { return vec4(1.79284291400159) - 0.85373472095314 * r; }

        float snoise(vec3 v) {
            const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

            // First corner
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);

            // Other corners
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = vec3(1.0) - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);

            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.xxx * 2.0;
            vec3 x3 = x0 - vec3(1.0) + C.xxx * 3.0;

            // Permutations
            i = mod(i, 289.0);
            vec4 p = permute(permute(permute(
                        i.z + vec4(0.0, i1.z, i2.z, 1.0))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

            // Gradients
            float n_ = 0.142857142857; // 1.0 / 7.0
            vec3  ns = n_ * D.wyz - D.xzx;

            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_);

            vec4 x = x_ * ns.x + ns.yyyy;
            vec4 y = y_ * ns.x + ns.yyyy;
            vec4 h = vec4(1.0) - abs(x) - abs(y);

            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);

            vec4 s0 = floor(b0) * 2.0 + vec4(1.0);
            vec4 s1 = floor(b1) * 2.0 + vec4(1.0);
            vec4 sh = -step(h, vec4(0.0));

            vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);

            // Normalise gradients
            vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;

            // Mix contributions
            vec4 m = max(vec4(0.6) - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4(0.0));
            m = m * m;
            return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
        }

        void main() {
            // Coordinate mapping (with optional aspect ratio preservation)
            // Centered on and scaled with the board square and camera pan/zoom
            vec2 uv;
            if (u_aspect) {
                vec2 boardCenter = u_resolution * 0.5 + vec2(u_pan.x, -u_pan.y);
                float squareSize = min(u_resolution.x, u_resolution.y) * u_zoom;
                vec2 squareOrigin = boardCenter - vec2(squareSize, squareSize) * 0.5;
                uv = (gl_FragCoord.xy - squareOrigin) / squareSize;
            } else {
                uv = (gl_FragCoord.xy - vec2(u_pan.x, -u_pan.y)) / (u_resolution.xy * u_zoom);
            }

            // 3D coordinate: X and Y scale with noiseSize, Z moves with time * noiseSpeed
            vec3 pos = vec3(uv * u_noiseSize, u_time * u_noiseSpeed);

            // Layered fractal octaves
            float total = 0.0;
            float amplitude = 1.0;
            float frequency = 1.0;
            float maxAmplitude = 0.0;

            for (int i = 0; i < 4; i++) {
                if (i >= u_octaves) break;
                total += snoise(pos * frequency) * amplitude;
                maxAmplitude += amplitude;
                amplitude *= 0.5;
                frequency *= 2.0;
            }

            float normalizedNoise = (total / maxAmplitude) * 0.5 + 0.5;
            float shade = clamp(normalizedNoise, 0.0, 1.0);

            // Quantize into discrete steps (shades of gray)
            if (u_steps > 1.0) {
                float bucket = floor(clamp(shade, 0.0, 0.999999) * u_steps);
                shade = bucket / (u_steps - 1.0);
            }

            // Inversion check
            if (u_invert) {
                shade = 1.0 - shade;
            }

            gl_FragColor = vec4(vec3(shade), 1.0);
        }
    `
};

if (typeof window !== 'undefined') {
    window.PerlinShader = PerlinShader;
}
