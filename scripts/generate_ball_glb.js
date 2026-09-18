#!/usr/bin/env node
/**
 * Build a lightweight soccer-ball GLB into apps/web/public/models/ball.glb.
 * Uses a hand-rolled minimal glTF binary (no browser FileReader).
 * Run: node scripts/generate_ball_glb.js
 */
const fs = require("fs");
const path = require("path");

const out = path.join(__dirname, "../apps/web/public/models/ball.glb");
fs.mkdirSync(path.dirname(out), { recursive: true });

/** Unit sphere approx via lat/long grid, scaled to radius 0.11 m */
function buildSphere(radius, segW, segH) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let y = 0; y <= segH; y++) {
    const v = y / segH;
    const phi = v * Math.PI;
    for (let x = 0; x <= segW; x++) {
      const u = x / segW;
      const theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      positions.push(nx * radius, ny * radius, nz * radius);
      normals.push(nx, ny, nz);
    }
  }
  for (let y = 0; y < segH; y++) {
    for (let x = 0; x < segW; x++) {
      const a = y * (segW + 1) + x;
      const b = a + segW + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, indices };
}

const { positions, normals, indices } = buildSphere(0.11, 24, 16);
const posBuf = Buffer.from(new Float32Array(positions).buffer);
const norBuf = Buffer.from(new Float32Array(normals).buffer);
const idxBuf = Buffer.from(new Uint16Array(indices).buffer);
// Align to 4 bytes
function pad4(buf) {
  const n = (4 - (buf.length % 4)) % 4;
  return n ? Buffer.concat([buf, Buffer.alloc(n)]) : buf;
}
const bin = pad4(Buffer.concat([posBuf, norBuf, idxBuf]));

const posByteLen = posBuf.length;
const norByteLen = norBuf.length;
const idxByteLen = idxBuf.length;
const norOffset = posByteLen;
const idxOffset = posByteLen + norByteLen;
const vertCount = positions.length / 3;

const gltf = {
  asset: { version: "2.0", generator: "snowpitch-generate_ball_glb" },
  scenes: [{ nodes: [0] }],
  scene: 0,
  nodes: [{ mesh: 0 }],
  meshes: [
    {
      primitives: [
        {
          attributes: { POSITION: 0, NORMAL: 1 },
          indices: 2,
          material: 0,
        },
      ],
    },
  ],
  materials: [
    {
      name: "Ball",
      pbrMetallicRoughness: {
        baseColorFactor: [0.96, 0.97, 0.95, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.35,
      },
    },
  ],
  accessors: [
    {
      bufferView: 0,
      componentType: 5126,
      count: vertCount,
      type: "VEC3",
      max: [0.11, 0.11, 0.11],
      min: [-0.11, -0.11, -0.11],
    },
    {
      bufferView: 1,
      componentType: 5126,
      count: vertCount,
      type: "VEC3",
    },
    {
      bufferView: 2,
      componentType: 5123,
      count: indices.length,
      type: "SCALAR",
    },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posByteLen, target: 34962 },
    { buffer: 0, byteOffset: norOffset, byteLength: norByteLen, target: 34962 },
    { buffer: 0, byteOffset: idxOffset, byteLength: idxByteLen, target: 34963 },
  ],
  buffers: [{ byteLength: bin.length }],
};

const json = Buffer.from(JSON.stringify(gltf));
const jsonPad = pad4(json);
const jsonChunkLen = jsonPad.length;
const binChunkLen = bin.length;
const totalLen = 12 + 8 + jsonChunkLen + 8 + binChunkLen;

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // glTF
header.writeUInt32LE(2, 4);
header.writeUInt32LE(totalLen, 8);

const jsonChunkHeader = Buffer.alloc(8);
jsonChunkHeader.writeUInt32LE(jsonChunkLen, 0);
jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // JSON

const binChunkHeader = Buffer.alloc(8);
binChunkHeader.writeUInt32LE(binChunkLen, 0);
binChunkHeader.writeUInt32LE(0x004e4942, 4); // BIN

const glb = Buffer.concat([header, jsonChunkHeader, jsonPad, binChunkHeader, bin]);
fs.writeFileSync(out, glb);
console.log(`Wrote ${out} (${glb.length} bytes)`);
