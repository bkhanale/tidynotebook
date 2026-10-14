/** Remove the unused optional schema peer before dependency resolution. */
module.exports = {
  hooks: {
    /** @param {{name?: string, version?: string, peerDependencies?: Record<string, string>, peerDependenciesMeta?: Record<string, {optional?: boolean}>}} pkg */
    readPackage(pkg) {
      if (pkg.name !== 'better-auth') return pkg;
      if (
        pkg.version !== '1.7.7' ||
        pkg.peerDependencies?.['drizzle-kit'] !==
          '>=0.31.4 || >=1.0.0-beta.1' ||
        pkg.peerDependenciesMeta?.['drizzle-kit']?.optional !== true
      )
        throw new Error('Review the Better Auth schema peer before an update.');
      delete pkg.peerDependencies['drizzle-kit'];
      delete pkg.peerDependenciesMeta['drizzle-kit'];
      return pkg;
    },
  },
};
