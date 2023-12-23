struct Particle
{
    pos : vec2<f32>,
    vel : vec2<f32>,
}

struct SimParams 
{
    deltaT : f32, mass : f32, 
    smoothingR : f32, 
    targetDensity : f32,
    pressureMult : f32,
    damping : f32, 
    gravity : f32,
    lookAhead: f32,
    steps: f32,
    resX : f32,  resY : f32,
    monX : f32, monY : f32,
    mouseX: f32, mouseY: f32,
    mStr: f32, mRadius: f32
}

struct Particles { particles : array<Particle> }

@binding(0) @group(0) var<uniform> params : SimParams;
@binding(1) @group(0) var<storage, read_write> particlesA : Particles;
@binding(2) @group(0) var<storage, read_write> particlesB : Particles;
@binding(3) @group(0) var<storage, read_write> densities: array<f32>;

fn SmoothingKernel (radius: f32, dst: f32) -> f32
{
    var volume = 3.1415 * pow(radius, 4.0) / 6.0;
    if (dst >= radius) { return 0.0; };
    return (radius-dst) * (radius-dst) / volume;
}

fn getPressure( density: f32 ) -> f32
{
    return (density - (params.targetDensity * 1e-4)) * params.pressureMult * 10e5;
}

fn SmoothingKernelDerivitave (radius: f32, dst: f32) -> f32
{
    if (dst >= radius) { return 0.0; };
    return (dst - radius) * 12.0 / (pow(radius, 4.0) * 3.1415);
}

// disabled viscosity for now

fn viscosityForce(pID: u32) -> vec2<f32>
{
    var gr: vec2<f32>;
    var strength = 0.2;

    for (var i = 0u; i < arrayLength(&particlesA.particles); i++) 
    {
        var dst = distance(particlesA.particles[i].pos, particlesA.particles[pID].pos);
        var influence = SmoothingKernelDerivitave(60.0, dst);
        //gr += (particlesA.particles[i].vel - particlesA.particles[pID].vel) * influence;
    }

    return gr * strength;
}

fn interactionForce(pID: u32) -> vec2<f32>
{
    var interactionForce = vec2<f32>(0.0, 0.0);
    if (params.mStr == 0.0) { return interactionForce; }

    var mousePos = vec2<f32>(params.mouseX, params.resY-params.mouseY);
    var offset = mousePos - particlesA.particles[pID].pos;
    var sqrDst = dot(offset, offset);

    if (sqrDst < params.mRadius * params.mRadius)
    {
        var dst = sqrt(sqrDst); var dir = vec2<f32>(0.0, 0.0);
        if (dst > 1e-2) { dir = offset / dst; }

        var centreT = 1.0 - (dst / params.mRadius);
        interactionForce += (dir * params.mStr - particlesA.particles[pID].vel) * centreT;
    }

    return interactionForce;
}

fn pressureForce(pID: u32) -> vec2<f32>
{
    var gr: vec2<f32>; var dir: vec2<f32>; 
    var slope = 0.0; var dst = 0.0; var pressure = 0.0;

    for (var i = 0u; i < arrayLength(&particlesA.particles); i++) 
    {
        dst = distance(particlesA.particles[i].pos, particlesA.particles[pID].pos);

        if ( dst > 0.0 )
        {
            dir = (particlesA.particles[i].pos - particlesA.particles[pID].pos) / dst;
            slope = SmoothingKernelDerivitave(params.smoothingR, dst);
            
            pressure = (getPressure(densities[i]) + getPressure(densities[pID])) / 2.0;
            if ( densities[i] > 0.0 ) { gr += pressure * dir * slope * params.mass / densities[i]; }
        }
    }

    return gr;
}

fn calculateDensity(index: u32) 
{
    var density = 0.0;

    for (var i = 0u; i < arrayLength(&particlesA.particles); i++) 
    {
        var mag = distance(particlesA.particles[i].pos, particlesA.particles[index].pos);
        density += params.mass * SmoothingKernel(params.smoothingR, mag);
    }
    densities[index] = density;
}

@compute @workgroup_size(64)

fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>)
{
    // note: to make the particles compact-er 
    // lower BOTH the mass and smoothing radius
    // and then bring up the pressure mult

    var index = GlobalInvocationID.x;
    var vVel = particlesA.particles[index].vel;
    var originalPos = particlesA.particles[index].pos;
    var pos : vec2<f32>;
    var vel : vec2<f32>;
    var radius = 10.0;
    var dT = params.deltaT / params.steps;
    var b = dT * 90.0;

    // simulation substeps

    for (var i = 0.0; i < params.steps; i += 1.0)
    {
        // store the predicted positions in particlesA

        particlesA.particles[index].pos = originalPos + (vVel * 1.0/(params.lookAhead));
        storageBarrier();

        // calculate the density at particle predicted pos

        calculateDensity(index); 
        storageBarrier();

        // Apply external forces to the particle

        var pF = pressureForce(index) * b;
        var mF = interactionForce(index) * b;
        var vF = viscosityForce(index) * b; 
        var gF = vec2<f32>(0.0, -1.0) * params.gravity * b;

        vVel += (pF + mF + vF + gF);
        storageBarrier();

        // Apply velocity to position in monitor space
        // and resolve bounds in canvas space

        originalPos = originalPos + vVel * dT;

        var newX = clamp(originalPos.x, radius, params.resX-radius);
        if (newX != originalPos.x) { vVel.x *= -params.damping; };
        originalPos.x = newX;

        var newY = clamp(originalPos.y, radius, params.resY-radius);
        if (newY != originalPos.y) { vVel.y *= -params.damping; };
        originalPos.y = newY;

        // calculations are finished revert the predicted position

        particlesA.particles[index].pos = originalPos; 
        storageBarrier();
    }

    particlesB.particles[index].pos = originalPos;
    particlesB.particles[index].vel = vVel;
}