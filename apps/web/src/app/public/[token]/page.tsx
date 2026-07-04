import { PublicDocumentViewer } from "@/components/sharing/public-document-viewer";

// Rendu dynamique (hérité du root layout /public — locale par cookie/header) ;
// le contenu dépend du token de toute façon.
export const dynamic = "force-dynamic";

/**
 * Public share link viewer — /public/[token].
 *
 * The URL mailed/copied from ShareDialog (`${origin}/public/{token}`) lands
 * here. NO authentication: the token is the capability, resolved against
 * GET /api/v1/sharing/public/{token} (404 → invalid/expired state). The page
 * itself is a thin server shell — all behaviour lives in the client viewer
 * (kept out of src/app/** so it is unit-testable per vitest config).
 */
export default async function PublicSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicDocumentViewer token={token} />;
}
