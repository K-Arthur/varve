declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?url' {
  const src: string;
  export default src;
}

declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}
