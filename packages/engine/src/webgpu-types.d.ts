/**
 * Minimal WebGPU type declarations for the GPU Accelerator module.
 *
 * The full `@webgpu/types` package lives in `@strata/compositor`; we keep a
 * focused subset here to avoid a type-only cross-package dependency while
 * still getting strict checking on the compute-shader interface.
 */

interface GPUAdapter {
  requestAdapterInfo(): Promise<GPUAdapterInfo>;
  requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  readonly limits: GPUSupportedLimits;
  readonly features: GPUSupportedFeatures;
}

interface GPUAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

interface GPUDevice {
  readonly limits: GPUSupportedLimits;
  readonly lost: Promise<GPUDeviceLostInfo>;
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createCommandEncoder(): GPUCommandEncoder;
  createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
  createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
  createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createRenderBundleEncoder(descriptor: GPURenderBundleEncoderDescriptor): GPURenderBundleEncoder;
  readonly queue: GPUQueue;
  destroy(): void;
}

interface GPUDeviceLostInfo {
  reason: GPUDeviceLostReason;
  message: string;
}

type GPUDeviceLostReason = 'destroyed' | 'unknown';

interface GPUSupportedLimits {
  maxTextureDimension2D: number;
  maxStorageBufferBindingSize: number;
}

interface GPUSupportedFeatures {
  has(name: string): boolean;
}

interface GPUBuffer {
  destroy(): void;
  readonly size: number;
  readonly usage: number;
  mapAsync(mode: GPUMapModeFlags, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}

interface GPUBindGroup {
  readonly layout?: GPUBindGroupLayout;
}

interface GPUBindGroupLayout {}

interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}

interface GPUComputePipelineDescriptor {
  layout: 'auto' | GPUPipelineLayout;
  compute: GPUProgrammableStage;
}

interface GPUProgrammableStage {
  module: GPUShaderModule;
  entryPoint: string;
  constants?: Record<string, number>;
}

interface GPUShaderModule {
  readonly compilationInfo?: Promise<GPUCompilationInfo>;
}

interface GPUCompilationInfo {
  readonly messages: readonly GPUCompilationMessage[];
}

interface GPUCompilationMessage {
  readonly message: string;
  readonly type: GPUCompilationMessageType;
  readonly lineNum: number;
  readonly linePos: number;
  readonly offset: number;
  readonly length: number;
}

type GPUCompilationMessageType = 'error' | 'warning' | 'info';

interface GPUCommandEncoder {
  beginComputePass(descriptor?: GPUComputePassDescriptor): GPUComputePassEncoder;
  beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
  copyBufferToBuffer(
    source: GPUBuffer,
    sourceOffset: number,
    destination: GPUBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  copyExternalImageToTexture(
    source: GPUImageCopyExternalImage,
    destination: GPUTextureCopyView,
    copySize: GPUExtent3D,
  ): void;
  finish(): GPUCommandBuffer;
}

interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: Iterable<number>): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

interface GPURenderPassEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: Iterable<number>): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  executeBundles(bundles: Iterable<GPURenderBundle>): void;
  end(): void;
}

interface GPUComputePassDescriptor {}

interface GPURenderPassDescriptor {
  colorAttachments: Iterable<GPURenderPassColorAttachment>;
}

interface GPURenderPassColorAttachment {
  view: GPUTextureView;
  depthSlice?: number;
  resolveTarget?: GPUTextureView;
  clearValue?: GPUColor;
  loadOp: GPULoadOp;
  storeOp: GPUStoreOp;
}

type GPULoadOp = 'load' | 'clear';
type GPUStoreOp = 'store' | 'discard';
type GPUColor = { r: number; g: number; b: number; a: number };

interface GPUCommandBuffer {}

interface GPUQueue {
  submit(commandBuffers: Iterable<GPUCommandBuffer>): void;
  writeBuffer(
    buffer: GPUBuffer,
    bufferOffset: number,
    data: BufferSource,
    dataOffset?: number,
    size?: number,
  ): void;
  copyExternalImageToTexture(
    source: GPUImageCopyExternalImage,
    destination: GPUTextureCopyView,
    copySize: GPUExtent3D,
  ): void;
}

interface GPUImageCopyExternalImage {
  source: HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
  origin?: GPUOrigin2D;
  flipY?: boolean;
}

interface GPUTexture {
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
  destroy(): void;
}

interface GPUTextureView {}

interface GPUTextureViewDescriptor {
  format?: GPUTextureFormat;
  dimension?: GPUTextureViewDimension;
  aspect?: GPUTextureAspect;
  baseMipLevel?: number;
  mipLevelCount?: number;
  baseArrayLayer?: number;
  arrayLayerCount?: number;
}

interface GPUTextureDescriptor {
  size: GPUExtent3D;
  mipLevelCount?: number;
  sampleCount?: number;
  dimension?: GPUTextureDimension;
  format: GPUTextureFormat;
  usage: GPUTextureUsageFlags;
  label?: string;
}

type GPUTextureFormat = string;
type GPUTextureDimension = '1d' | '2d' | '3d';
type GPUTextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
type GPUTextureAspect = 'all' | 'stencil-only' | 'depth-only';
type GPUTextureUsageFlags = number;
type GPUExtent3D =
  | [number, number, number]
  | { width: number; height?: number; depthOrArrayLayers?: number };
type GPUOrigin2D = [number, number] | { x?: number; y?: number };
type GPUBufferUsageFlags = number;

interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: Iterable<GPUBindGroupEntry>;
}

interface GPUBindGroupEntry {
  binding: number;
  resource: GPUBindingResource;
}

type GPUBindingResource = GPUBufferBinding | GPUSampler | GPUTextureView;

interface GPUBufferBinding {
  buffer: GPUBuffer;
  offset?: number;
  size?: number;
}

interface GPUBindGroupLayoutDescriptor {
  entries: Iterable<GPUBindGroupLayoutEntry>;
}

interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: GPUShaderStageFlags;
  buffer?: GPUBufferBindingLayout;
  sampler?: GPUSamplerBindingLayout;
  texture?: GPUTextureBindingLayout;
  storageTexture?: GPUStorageTextureBindingLayout;
}

interface GPUBufferBindingLayout {
  type?: GPUBufferBindingType;
  hasDynamicOffset?: boolean;
  minBindingSize?: number;
}

type GPUBufferBindingType = 'uniform' | 'storage' | 'read-only-storage';
type GPUShaderStageFlags = number;

interface GPUSamplerBindingLayout {
  type?: GPUSamplerBindingType;
}

type GPUSamplerBindingType = 'filtering' | 'non-filtering' | 'comparison';

interface GPUTextureBindingLayout {
  sampleType?: GPUTextureSampleType;
  viewDimension?: GPUTextureViewDimension;
  multisampled?: boolean;
}

type GPUTextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';

interface GPUStorageTextureBindingLayout {
  access?: GPUStorageTextureAccess;
  format: GPUTextureFormat;
  viewDimension?: GPUTextureViewDimension;
}

type GPUStorageTextureAccess = 'write-only' | 'read-only' | 'read-write';

interface GPUBufferDescriptor {
  size: number;
  usage: GPUBufferUsageFlags;
  mappedAtCreation?: boolean;
  label?: string;
}

interface GPUSamplerDescriptor {
  addressModeU?: GPUAddressMode;
  addressModeV?: GPUAddressMode;
  addressModeW?: GPUAddressMode;
  magFilter?: GPUFilterMode;
  minFilter?: GPUFilterMode;
  mipmapFilter?: GPUFilterMode;
  lodMinClamp?: number;
  lodMaxClamp?: number;
  compare?: GPUCompareFunction;
  maxAnisotropy?: number;
  label?: string;
}

type GPUAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
type GPUFilterMode = 'nearest' | 'linear';
type GPUCompareFunction =
  | 'never'
  | 'less'
  | 'equal'
  | 'less-equal'
  | 'greater'
  | 'not-equal'
  | 'greater-equal'
  | 'always';

interface GPUSampler {}

interface GPUCanvasContext {
  configure(descriptor: GPUCanvasConfiguration): void;
  getCurrentTexture(): GPUTexture;
  unconfigure(): void;
}

interface GPUCanvasConfiguration {
  device: GPUDevice;
  format: GPUTextureFormat;
  usage?: GPUTextureUsageFlags;
  viewFormats?: Iterable<GPUTextureFormat>;
  colorSpace?: PredefinedColorSpace;
  alphaMode?: GPUCanvasAlphaMode;
  label?: string;
}

type GPUCanvasAlphaMode = 'opaque' | 'premultiplied';

interface GPURenderPipeline {
  readonly layout: GPUPipelineLayout;
}

interface GPURenderPipelineDescriptor {
  layout: 'auto' | GPUPipelineLayout;
  vertex: GPUVertexState;
  fragment?: GPUFragmentState;
  primitive: GPUPrimitiveState;
  depthStencil?: GPUDepthStencilState;
  multisample?: GPUMultisampleState;
  label?: string;
}

interface GPUVertexState {
  module: GPUShaderModule;
  entryPoint: string;
  constants?: Record<string, number>;
  buffers?: Iterable<GPUVertexBufferLayout>;
}

interface GPUVertexBufferLayout {
  arrayStride: number;
  stepMode?: GPUVertexStepMode;
  attributes: Iterable<GPUVertexAttribute>;
}

type GPUVertexStepMode = 'vertex' | 'instance';

interface GPUVertexAttribute {
  shaderLocation: number;
  offset: number;
  format: GPUVertexFormat;
}

type GPUVertexFormat = string;

interface GPUFragmentState {
  module: GPUShaderModule;
  entryPoint: string;
  constants?: Record<string, number>;
  targets: Iterable<GPUColorTargetState>;
}

interface GPUColorTargetState {
  format: GPUTextureFormat;
  blend?: GPUBlendState;
  writeMask?: GPUColorWriteFlags;
}

type GPUColorWriteFlags = number;

interface GPUBlendState {
  color: GPUBlendComponent;
  alpha: GPUBlendComponent;
}

interface GPUBlendComponent {
  srcFactor: GPUBlendFactor;
  dstFactor: GPUBlendFactor;
  operation: GPUBlendOperation;
}

type GPUBlendFactor =
  | 'zero'
  | 'one'
  | 'src'
  | 'one-minus-src'
  | 'dst'
  | 'one-minus-dst'
  | 'src-alpha'
  | 'one-minus-src-alpha'
  | 'dst-alpha'
  | 'one-minus-dst-alpha'
  | 'src-alpha-saturated'
  | 'constant'
  | 'one-minus-constant';
type GPUBlendOperation = 'add' | 'subtract' | 'reverse-subtract' | 'min' | 'max';

interface GPUPrimitiveState {
  topology: GPUPrimitiveTopology;
  stripIndexFormat?: GPUIndexFormat;
  frontFace?: GPUFrontFace;
  cullMode?: GPUCullMode;
}

type GPUPrimitiveTopology =
  | 'point-list'
  | 'line-list'
  | 'line-strip'
  | 'triangle-list'
  | 'triangle-strip';
type GPUFrontFace = 'ccw' | 'cw';
type GPUCullMode = 'none' | 'front' | 'back';
type GPUIndexFormat = 'uint16' | 'uint32';

interface GPUDepthStencilState {
  format: GPUTextureFormat;
  depthWriteEnabled?: boolean;
  depthCompare?: GPUCompareFunction;
  stencilFront?: GPUStencilFaceState;
  stencilBack?: GPUStencilFaceState;
  stencilReadMask?: number;
  stencilWriteMask?: number;
  depthBias?: number;
  depthBiasSlopeScale?: number;
  depthBiasClamp?: number;
}

interface GPUStencilFaceState {
  compare?: GPUCompareFunction;
  failOp?: GPUStencilOperation;
  depthFailOp?: GPUStencilOperation;
  passOp?: GPUStencilOperation;
}

type GPUStencilOperation =
  | 'keep'
  | 'zero'
  | 'replace'
  | 'invert'
  | 'increment-clamp'
  | 'decrement-clamp'
  | 'increment-wrap'
  | 'decrement-wrap';

interface GPUMultisampleState {
  count?: number;
  mask?: number;
  alphaToCoverageEnabled?: boolean;
}

interface GPUPipelineLayout {}

interface GPUPipelineLayoutDescriptor {
  bindGroupLayouts: Iterable<GPUBindGroupLayout>;
  label?: string;
}

interface GPURenderBundleEncoder {
  setPipeline(pipeline: GPURenderPipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup, dynamicOffsets?: Iterable<number>): void;
  setVertexBuffer(slot: number, buffer: GPUBuffer, offset?: number, size?: number): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  finish(descriptor?: GPURenderBundleEncoderDescriptor): GPURenderBundle;
}

interface GPURenderBundleEncoderDescriptor {
  colorFormats: Iterable<GPUTextureFormat>;
  depthStencilFormat?: GPUTextureFormat;
  sampleCount?: number;
  depthReadOnly?: boolean;
  stencilReadOnly?: boolean;
  label?: string;
}

interface GPURenderBundle {}

interface GPUTextureCopyView {
  texture: GPUTexture;
  mipLevel?: number;
  origin?: GPUOrigin3D;
  aspect?: GPUTextureAspect;
}

type GPUOrigin3D = [number, number, number] | { x?: number; y?: number; z?: number };

declare const GPUBufferUsage: {
  MAP_READ: number;
  MAP_WRITE: number;
  COPY_SRC: number;
  COPY_DST: number;
  INDEX: number;
  VERTEX: number;
  UNIFORM: number;
  STORAGE: number;
  INDIRECT: number;
  QUERY_RESOLVE: number;
};

declare const GPUMapMode: {
  READ: number;
  WRITE: number;
};

declare const GPUShaderStage: {
  VERTEX: number;
  FRAGMENT: number;
  COMPUTE: number;
};

interface Navigator {
  readonly gpu?: {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  };
}

interface GPURequestAdapterOptions {
  powerPreference?: 'low-power' | 'high-performance';
  forceFallbackAdapter?: boolean;
}
