export function getAdminBasePath(value = process.env.ADMIN_PATH) {
  if (!value) return "/admin";
  const path = value.trim().replace(/^\/+|\/+$/g, "");
  if (!path || path === "api" || path.startsWith("api/")) return "/admin";
  return `/${path}`;
}

export function getAdminHref(href: string, value = process.env.ADMIN_PATH) {
  const basePath = getAdminBasePath(value);
  if (basePath === "/admin") return href;
  if (href === "/admin") return basePath;
  if (href.startsWith("/admin/")) return `${basePath}${href.slice("/admin".length)}`;
  if (href.startsWith("/admin?")) return `${basePath}${href.slice("/admin".length)}`;
  return href;
}
