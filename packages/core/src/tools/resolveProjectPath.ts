import path from "node:path";

export function resolveProjectPath(
  projectRoot: string,
  requestedPath: string,
): string {
  if (!requestedPath.trim()) {
    throw new Error("A file path is required.");
  }

  if (requestedPath.includes("\0")) {
    throw new Error("File paths cannot contain null characters.");
  }

  // Reject paths like C:\secret.txt or /etc/passwd immediately.
  if (path.isAbsolute(requestedPath)) {
    throw new Error("Absolute paths are not allowed.");
  }

  const root = path.resolve(projectRoot);
  const resolvedPath = path.resolve(root, requestedPath);

  // Find the path from root → resolvedPath.
  const relativePath = path.relative(root, resolvedPath);

  // If it begins with "..", it escaped the project directory.
  // isAbsolute handles unusual Windows cases such as a different drive.
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Path must stay inside the current project.");
  }

  return resolvedPath;
}