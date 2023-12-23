struct VertexOutput 
{
    @builtin(position) position : vec4<f32>,
    @location(4) color : vec4<f32>,
    @location(5) coord : vec2<f32>,
}

struct Res {
    canvas: vec2f,
    monitor: vec2f
};

@group(0) @binding(0) var<uniform> res: Res;

fn gradient
( 
    c1: vec3<f32>, c2: vec3<f32>, c3: vec3<f32>, c4: vec3<f32>,
    x: f32 
) 
-> vec3<f32>
{
    return
        pow(1.0-abs(x - 0.00), 4.0)*c1 +
        pow(1.0-abs(x - 0.33), 4.0)*c2 +
        pow(1.0-abs(x - 0.66), 4.0)*c3 +
        pow(1.0-abs(x - 1.00), 4.0)*c4;
}

@vertex
fn vert_main
(
    @location(0) a_particlePos : vec2<f32>,
    @location(1) a_particleVel : vec2<f32>,
    @location(2) a_pos : vec2<f32>,
) -> VertexOutput 
{
    let angle = -atan2(a_particleVel.x, a_particleVel.y);
    var pos = vec2(
        (a_pos.x * cos(angle)) - (a_pos.y * sin(angle)),
        (a_pos.x * sin(angle)) + (a_pos.y * cos(angle))
    );

    var output : VertexOutput;

    // static screen positions!
    var size = 8.0; var xy = ((a_particlePos / res.canvas)- vec2(0.5,0.5)) * 2.0;
    pos.x = pos.x * size / res.canvas.x; pos.y = pos.y * size / res.canvas.y;
    output.position = vec4(pos+xy, 0.0 * res.canvas.x, 1.0);

    // output color
    var c4 = vec3(0.90,0.89,0.20);
    var c3 = vec3(0.21,0.71,0.47);
    var c2 = vec3(0.18,0.45,0.56);
    var c1 = vec3(0.28,0.15,0.43); 


    output.color = vec4(gradient(c1, c2, c3, c4, clamp(0.0, 1.0, distance(vec2(0.0,0.0), a_particleVel)*0.003)), 1.0);

    output.coord = output.position.xy;
    return output;
}

@fragment
fn frag_main
(
    @location(4) color : vec4<f32>,
    @location(5) coord : vec2<f32>,
    @builtin(position) p : vec4<f32>
) 
-> @location(0) vec4<f32> 
{
    return color;
}