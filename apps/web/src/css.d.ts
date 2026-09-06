/** Ambient declarations of the web application. */
declare module '*.css';
declare module '*?worker' {
  const factory: new () => Worker;
  export default factory;
}
