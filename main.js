import Stats from "./modules/stats.module.js";
import { GUI } from "./modules/dat.gui.module.js";

// top left text display

const display = document.getElementById("display");
display.innerHTML = 
`
<h3>SPH Fluid Simulation</h3>
- Interact using both mouse buttons<br>
- Try resizing the broswer window<br>
<br>Visit the 
<a href="https://github.com/aydensdev/fluidsim" target="_blank">
repository</a> for more info.
`;

var stats = new Stats();
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
stats.dom.style = 'position: fixed; top: 0px; right: 270px; cursor: pointer; opacity: 0.9; z-index: 10000;';
document.body.appendChild( stats.dom );

async function loadShader(url) {
    const response = await fetch(url);
    return await response.text();
}

const simParams = 
{
    deltaT: 1/60,
    mass: 0.1,
    smoothingR: 25,
    targetDensity: 8.2,
    pressureMult: 51,
    damping: 0.5,
    gravity: 7,
    lookAhead: 140,
    steps: 1,
    resX: 0, resY: 0,
    monX: 0, monY: 0,
    mX: 0, mY: 0,
    mStr: 0, mRad: 120,
};

// an extreme low smoothing radius behaves like sand
// it controls how easily the fluid is able to "flow"

const STR = 300;
const canvas = document.getElementById('container');

window.onload = async function init()
{
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');

    context.configure({
        device,
        format: navigator.gpu.getPreferredCanvasFormat(),
        alphaMode: 'opaque',
    });

    // Load shaders from wgsl files

    async function loadShader(url) {
        const response = await fetch(url);
        return device.createShaderModule({ code: await response.text() });
    }

    const computeModule = await loadShader("./compute.wgsl");
    const shaderSpriteModule = await loadShader("./sprite.wgsl");

    // Create particle rendering pipeline

    const renderPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: 
        {
            module: shaderSpriteModule,
            entryPoint: 'vert_main',
            buffers: 
            [
                {
                    arrayStride: 4 * 4,
                    stepMode: 'instance',
                    attributes: [
                        // particle position
                        { shaderLocation: 0, offset: 0, format: 'float32x2'},
                        // particle velocity
                        { shaderLocation: 1, offset: 2 * 4, format: 'float32x2'}
                    ],
                },
                {
                    arrayStride: 2 * 4,
                    // a_pos??
                    stepMode: 'vertex',
                    attributes: [{
                        shaderLocation: 2, offset: 0, format: 'float32x2',
                    }],
                }
            ],
        },
        fragment: 
        {
            module: shaderSpriteModule,
            entryPoint: 'frag_main',
            targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
        },
        primitive: { topology: 'triangle-list' }
    });
    
    // Create processing pipeline for particles

    const computePipeline = device.createComputePipeline(
    {
        layout: 'auto',
        compute: {
            module: computeModule,
            entryPoint: 'main',
        },
    });

    // Template for render pass

    const renderPassDescriptor = 
    {
        colorAttachments: [
            {
            view: undefined,
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
            },
        ],
    };

    // Particle vertices (shape)

    function generateCircle(s)
    {   
        var array = [], outer = [];

        for (let i = 0; i < s; i++)
        {   
            var e = 2*Math.PI/s*i;
            outer.push({x: Math.sin(e), y:Math.cos(e)});
        }

        for (let i = 0; i < s; i++)
        {
            var i2 = (i+1)%outer.length
            array.push(0.0); array.push(0.0);
            array.push(outer[i].x); array.push(outer[i].y);
            array.push(outer[i2].x); array.push(outer[i2].y);
        }

        return new Float32Array(array);
    }

    const vertexBufferData = generateCircle(8);

    const spriteVertexBuffer = device.createBuffer({
        size: vertexBufferData.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });

    new Float32Array(spriteVertexBuffer.getMappedRange()).set(vertexBufferData);
    spriteVertexBuffer.unmap();

    // Create uniform buffer for passing sim params to compute shader

    const simParamBuffer = device.createBuffer({
        size: Object.keys(simParams).length * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Pass the resolutions to the vertex shader

    const resBuffer = device.createBuffer({
        size: 4*4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const resValues = new Float32Array(4);


    function updateSimParams() 
    {
        device.queue.writeBuffer(
            simParamBuffer, 0,
            new Float32Array([
                simParams.deltaT,
                simParams.mass,
                simParams.smoothingR,
                simParams.targetDensity,
                simParams.pressureMult,
                simParams.damping,
                simParams.gravity,
                simParams.lookAhead,
                simParams.steps,
                simParams.resX,
                simParams.resY,
                simParams.monX,
                simParams.monY,
                simParams.mX,
                simParams.mY,
                simParams.mStr,
                simParams.mRad,
            ])
        );

        resValues.set([canvas.width, canvas.height, window.outerWidth, window.outerHeight], 0);
        device.queue.writeBuffer(resBuffer, 0, resValues);
    }

    window.onresize = function ()
    {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        simParams.resX = canvas.width;
        simParams.resY = canvas.height;
        simParams.monX = window.outerWidth;
        simParams.monY = window.outerHeight;

        updateSimParams();
    }

    window.onmousemove = function(e)
    {
        simParams.mX = e.x;
        simParams.mY = e.y;
        updateSimParams();
    };

    window.onmousedown = function(e)
    {
        simParams.mStr = STR * [-1, 0, 1][e.button];
        updateSimParams();
    }

    window.onmouseup = function(e)
    {
        simParams.mStr = 0;
        updateSimParams();
    }

    document.oncontextmenu = (e) => e.preventDefault();
    window.onresize();

    const gui = new GUI()
    gui.domElement.id = 'gui';

    const folder = gui.addFolder('Simulation Settings');
    folder.add(simParams, 'mass', 0.01, 0.2, 0.01).onChange(updateSimParams);
    folder.add(simParams, 'smoothingR', 10, 50,1).onChange(updateSimParams);
    folder.add(simParams, 'targetDensity', 0, 20, 0.5).onChange(updateSimParams);
    folder.add(simParams, 'pressureMult', 1, 80, 0.5).onChange(updateSimParams);
    folder.add(simParams, 'damping', 0.1, 0.9, 0.05).onChange(updateSimParams);
    folder.add(simParams, 'gravity', 0.01, 12.0, 0.1).onChange(updateSimParams);
    folder.add(simParams, 'lookAhead', 20, 200, 1).onChange(updateSimParams);
    folder.add(simParams, 'steps', 1, 6, 1).onChange(updateSimParams);
    folder.open();

    gui.add({fs:()=>{document.body.requestFullscreen()}}, "fs").name("Click To Open Fullscreen");


    // Create buffers for particles

    const numParticles = 4e3;
    const pElem = 4, initialParticleData = new Float32Array(numParticles * pElem);
    for (let i = 0; i < numParticles; ++i)
    {
        // -1 to 1 UV coord on monitor screen
        initialParticleData[pElem*i + 0] = Math.random() * simParams.resX;
        initialParticleData[pElem*i + 1] = Math.random() * simParams.resY;
        initialParticleData[pElem*i + 2] = 0; //VELX
        initialParticleData[pElem*i + 3] = 0; //VELY
    }

    const particleBuffers = new Array(2);
    const particleBindGroups = new Array(2);

    for (let i = 0; i < 2; ++i) 
    {
        particleBuffers[i] = device.createBuffer({
            size: initialParticleData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
            mappedAtCreation: true,
        });
        new Float32Array(particleBuffers[i].getMappedRange()).set(
            initialParticleData
        );
        particleBuffers[i].unmap();
    }

    // empty buffer for densities
    const densitiesBuffer = device.createBuffer({
        size: new Float32Array(numParticles).byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    for (let i = 0; i < 2; ++i) {
        particleBindGroups[i] = device.createBindGroup({
            layout: computePipeline.getBindGroupLayout(0),
            entries: [
            {
                binding: 0,
                resource: {
                    buffer: simParamBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: particleBuffers[i],
                    offset: 0,
                    size: initialParticleData.byteLength,
                },
            },
            {
                binding: 2,
                resource: {
                    buffer: particleBuffers[(i + 1) % 2],
                    offset: 0,
                    size: initialParticleData.byteLength,
                },
            },
            {
                binding: 3,
                resource: {
                    buffer: densitiesBuffer,
                    offset: 0,
                    size: initialParticleData.byteLength/4,
                },
            }
            ],
        });
    };

    var vBindGroup = device.createBindGroup({
        layout: renderPipeline.getBindGroupLayout(0),
        entries: [{ 
            binding: 0, 
            resource: {
                buffer: resBuffer,
                offset: 0,
                size: 16,
            }
        }]
    });

    // render function

    let t = 0; var numVertex = vertexBufferData.length/2;
    function frame() 
    {
        stats.begin();
        simParams.deltaT = stats.dT();
        updateSimParams();

        renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

        const commandEncoder = device.createCommandEncoder();
        {
            const pass = commandEncoder.beginComputePass();
            pass.setPipeline(computePipeline);
            pass.setBindGroup(0, particleBindGroups[t % 2]);
            pass.dispatchWorkgroups(Math.ceil(numParticles / 64));
            pass.end();
        }
        {
            const pass = commandEncoder.beginRenderPass(renderPassDescriptor);
            pass.setPipeline(renderPipeline);
            pass.setVertexBuffer(0, particleBuffers[(t + 1) % 2]);
            pass.setVertexBuffer(1, spriteVertexBuffer);
            pass.setBindGroup(0, vBindGroup);
            pass.draw(numVertex, numParticles, 0, 0);
            pass.end();
        }

        device.queue.submit([commandEncoder.finish()]);

        // alternate buffers each frame using t
        // buffer A being processed, buffer B being rendered and vice versa
        ++t; stats.end();
        requestAnimationFrame(frame);
    }

    frame();
};
