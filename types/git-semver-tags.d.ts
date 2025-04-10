declare module 'git-semver-tags' {
  interface Options {
    lernaTags?: boolean;
    package?: string;
    skipUnstable?: boolean;
    tagPrefix?: string;
  }
  function gitSemverTags(options?: Options): Promise<string[]>;
  export = gitSemverTags;
}
