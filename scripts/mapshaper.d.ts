// mapshaper ships no type declarations. This covers only the call the build uses.
declare module "mapshaper" {
  type FileContents = string | Uint8Array;

  interface Mapshaper {
    /** Runs CLI-style commands on in-memory files and resolves with the `-o` outputs by file name. */
    applyCommands(
      commands: string,
      input?: Readonly<Record<string, FileContents>>,
    ): Promise<Record<string, FileContents>>;
  }

  const mapshaper: Mapshaper;
  export default mapshaper;
}
