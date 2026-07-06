/**
 * WebGPU ambient types for compositor typecheck.
 */

interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
  getPreferredCanvasFormat(): GPUTextureFormat;
}

interface GPUAdapter {
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  readonly info?: { description?: string };
}

interface GPUDevice {
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  readonly queue: GPUQueue;
  readonly lost: Promise<{ reason: string; message: string }>;
  destroy(): void;
}

interface GPUBuffer {
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

interface GPUCanvasContext {
  configure(configuration: GPUCanvasConfiguration): void;
  getCurrentTexture(): GPUTexture;
}

interface GPUTexture {
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
}

type GPUTextureView = Record<string, never>;

type GPUShaderModule = Record<string, never>;

interface GPURenderPipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

type GPUBindGroupLayout = Record<string, never>;

type GPUBindGroup = Record<string, never>;

interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: GPUBindGroupEntry[];
}

interface GPUBindGroupEntry {
  binding: number;
  resource: { buffer: GPUBuffer } | GPUTextureView;
}

interface GPUCommandEncoder {
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  finish(descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer;
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  end(): void;
}

type GPUCommandBuffer = Record<string, never>;

interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset?: number,
    size?: number,
  ): void;
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
}

type GPUDeviceDescriptor = Record<string, never>;

interface GPUBufferDescriptor {
  size: number;
  usage: number;
  mappedAtCreation?: boolean;
}

interface GPUShaderModuleDescriptor {
  code: string;
}

interface GPURenderPipelineDescriptor {
  layout: 'auto' | GPUPipelineLayout;
  vertex: GPUVertexState;
  fragment?: GPUFragmentState;
  primitive?: GPUPrimitiveState;
}

type GPUPipelineLayout = Record<string, never>;

interface GPUVertexState {
  module: GPUShaderModule;
  entryPoint: string;
  buffers?: GPUVertexBufferLayout[];
}

interface GPUFragmentState {
  module: GPUShaderModule;
  entryPoint: string;
  targets: GPUColorTargetState[];
}

interface GPUPrimitiveState {
  topology?: GPUPrimitiveTopology;
}

type GPUPrimitiveTopology = 'triangle-list' | 'triangle-strip' | 'line-list' | 'point-list';

interface GPUVertexBufferLayout {
  arrayStride: number;
  attributes: GPUVertexAttribute[];
}

interface GPUVertexAttribute {
  shaderLocation: number;
  offset: number;
  format: GPUVertexFormat;
}

type GPUVertexFormat = 'float32x2' | 'float32x4';

interface GPUColorTargetState {
  format: GPUTextureFormat;
  blend?: GPUBlendState;
}

type GPUBlendState = Record<string, never>;

type GPUTextureFormat = 'bgra8unorm' | 'rgba8unorm';

interface GPUCanvasConfiguration {
  device: GPUDevice;
  format: GPUTextureFormat;
  alphaMode?: 'opaque' | 'premultiplied';
}

interface GPURenderPassDescriptor {
  colorAttachments: (GPURenderPassColorAttachment | null)[];
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  clearValue?: GPUColor;
  loadOp: 'clear' | 'load';
  storeOp: 'store' | 'discard';
}

interface GPUColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

type GPUCommandBufferDescriptor = Record<string, never>;

type GPUTextureViewDescriptor = Record<string, never>;

declare const GPUBufferUsage: {
  MAP_WRITE: number;
  COPY_SRC: number;
  COPY_DST: number;
  VERTEX: number;
  UNIFORM: number;
};

interface Navigator {
  readonly gpu?: GPU;
}
