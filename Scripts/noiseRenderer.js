/**
 * Noise Renderer
 * ------------------------------------------------------------------
 * Handles WebGL context creation, shader compilation, full-screen quad geometry,
 * dynamic window resize scaling, and the continuous rendering loop.
 */

class NoiseRenderer {
    constructor(canvas, config) {
        this.canvas = canvas;
        this.config = config;
        this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

        if (!this.gl) {
            console.error('WebGL is not supported by your browser.');
            const ctx2d = canvas.getContext('2d');
            if (ctx2d) {
                ctx2d.fillStyle = '#111';
                ctx2d.fillRect(0, 0, canvas.width, canvas.height);
                ctx2d.fillStyle = '#fff';
                ctx2d.font = '16px sans-serif';
                ctx2d.fillText('WebGL is required to render the noise background.', 20, 40);
            }
            return;
        }

        this.program = null;
        this.uniforms = {};
        this.animationFrameId = null;
        this.startTime = performance.now();

        this.init();
    }

    init() {
        const gl = this.gl;

        // Compile shaders and create program
        const vertShader = this.compileShader(gl.VERTEX_SHADER, window.PerlinShader.vertexShaderSource);
        const fragShader = this.compileShader(gl.FRAGMENT_SHADER, window.PerlinShader.fragmentShaderSource);
        this.program = this.createProgram(vertShader, fragShader);
        gl.useProgram(this.program);

        // Full-screen quad geometry (two triangles covering clip space -1 to 1)
        const vertices = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0
        ]);

        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        const aPositionLocation = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(aPositionLocation);
        gl.vertexAttribPointer(aPositionLocation, 2, gl.FLOAT, false, 0, 0);

        // Cache uniform locations
        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            time: gl.getUniformLocation(this.program, 'u_time'),
            noiseSize: gl.getUniformLocation(this.program, 'u_noiseSize'),
            noiseSpeed: gl.getUniformLocation(this.program, 'u_noiseSpeed'),
            steps: gl.getUniformLocation(this.program, 'u_steps'),
            octaves: gl.getUniformLocation(this.program, 'u_octaves'),
            invert: gl.getUniformLocation(this.program, 'u_invert'),
            aspect: gl.getUniformLocation(this.program, 'u_aspect'),
            pan: gl.getUniformLocation(this.program, 'u_pan'),
            zoom: gl.getUniformLocation(this.program, 'u_zoom')
        };

        this.panX = 0;
        this.panY = 0;
        this.zoom = 1.0;

        // Initial resize
        this.resize();
        window.addEventListener('resize', () => this.resize());
    }

    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const err = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compilation error: ${err}`);
        }
        return shader;
    }

    createProgram(vertexShader, fragmentShader) {
        const gl = this.gl;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const err = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Program link error: ${err}`);
        }
        return program;
    }

    /**
     * Resizes the canvas buffer to match the window dimensions at high DPI.
     */
    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2); // Cap at 2 for performance
        const width = Math.floor(window.innerWidth * dpr);
        const height = Math.floor(window.innerHeight * dpr);

        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    /**
     * Main animation render step
     */
    render() {
        const gl = this.gl;
        const cfg = this.config;

        const elapsedTime = (performance.now() - this.startTime) / 1000.0;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        // Pass uniform values from NoiseConfig
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.time, elapsedTime);
        gl.uniform1f(this.uniforms.noiseSize, cfg.noiseSize);
        gl.uniform1f(this.uniforms.noiseSpeed, cfg.noiseSpeed);
        gl.uniform1f(this.uniforms.steps, cfg.steps);
        gl.uniform1i(this.uniforms.octaves, cfg.octaves || 1);
        gl.uniform1i(this.uniforms.invert, cfg.invert ? 1 : 0);
        gl.uniform1i(this.uniforms.aspect, cfg.maintainAspectRatio ? 1 : 0);
        gl.uniform2f(this.uniforms.pan, this.panX * dpr, this.panY * dpr);
        gl.uniform1f(this.uniforms.zoom, this.zoom);

        // Draw quad
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        this.animationFrameId = requestAnimationFrame(() => this.render());
    }

    setPanAndZoom(panX, panY, zoom) {
        this.panX = panX;
        this.panY = panY;
        this.zoom = zoom;
    }

    start() {
        if (!this.animationFrameId) {
            this.render();
        }
    }

    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.NoiseRenderer = NoiseRenderer;
}
