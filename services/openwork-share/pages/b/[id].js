import { buildBundleNarrative, buildBundleUrls, buildOgImageUrl, buildOpenInAppUrls, collectBundleItems, getBundleCounts, humanizeType, parseBundle, wantsDownload, wantsJsonResponse } from "../../api/_lib/share-utils.js";
import { fetchBundleJsonById } from "../../api/_lib/blob-store.js";
import ShareBundlePage from "../../components/share-bundle-page";

function buildMetadataRows(id, bundle, counts, schemaVersion) {
  return [
    { label: "ID", value: id },
    { label: "Type", value: bundle.type || "unknown" },
    { label: "Schema", value: schemaVersion },
    ...(counts.skillCount ? [{ label: "Skills", value: String(counts.skillCount) }] : []),
    ...(counts.agentCount ? [{ label: "Agents", value: String(counts.agentCount) }] : []),
    ...(counts.mcpCount ? [{ label: "MCPs", value: String(counts.mcpCount) }] : []),
    ...(counts.commandCount ? [{ label: "Commands", value: String(counts.commandCount) }] : []),
    ...(counts.hasConfig ? [{ label: "Config", value: "yes" }] : [])
  ];
}

export async function getServerSideProps(context) {
  const { params, query, req, res } = context;
  const id = String(params?.id ?? "").trim();
  const requestLike = { query, headers: req.headers };
  const serveJson = wantsJsonResponse(requestLike);

  if (!id) {
    if (serveJson) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "id is required" }));
      return { props: { responded: true } };
    }

    res.statusCode = 404;
    return {
      props: {
        missing: true,
        canonicalUrl: buildBundleUrls(req, "missing").shareUrl.replace(/\/b\/missing$/, "/"),
        ogImageUrl: buildOgImageUrl(req, "root")
      }
    };
  }

  try {
    const { blob, rawBuffer, rawJson } = await fetchBundleJsonById(id);

    if (serveJson) {
      res.setHeader("Vary", "Accept");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Content-Type", blob.contentType || "application/json");
      if (wantsDownload(requestLike)) {
        res.setHeader("Content-Disposition", `attachment; filename="openwork-bundle-${id}.json"`);
      }
      res.end(rawBuffer);
      return { props: { responded: true } };
    }

    const bundle = parseBundle(rawJson);
    const urls = buildBundleUrls(req, id);
    const ogImageUrl = buildOgImageUrl(req, id);
    const { openInAppDeepLink, openInWebAppUrl } = buildOpenInAppUrls(urls.shareUrl, {
      label: bundle.name || "Shared worker package"
    });
    const counts = getBundleCounts(bundle);
    const schemaVersion = bundle.schemaVersion == null ? "unknown" : String(bundle.schemaVersion);
    const typeLabel = humanizeType(bundle.type);
    const title = bundle.name || `OpenWork ${typeLabel}`;
    const description = bundle.description || buildBundleNarrative(bundle);
    const installHint =
      bundle.type === "skill"
        ? "Open in app to create a new worker and install this skill in one step."
        : bundle.type === "skills-set"
          ? "Open in app to create a new worker with this entire skills set already attached."
          : "Open in app to create a new worker with these skills, agents, MCPs, and config already bundled.";

    return {
      props: {
        responded: false,
        missing: false,
        id,
        title,
        description,
        canonicalUrl: urls.shareUrl,
        shareUrl: urls.shareUrl,
        jsonUrl: urls.jsonUrl,
        downloadUrl: urls.downloadUrl,
        ogImageUrl,
        openInAppDeepLink,
        openInWebAppUrl,
        installHint,
        bundleType: bundle.type || "unknown",
        typeLabel,
        schemaVersion,
        items: collectBundleItems(bundle, 8),
        metadataRows: buildMetadataRows(id, bundle, counts, schemaVersion)
      }
    };
  } catch {
    if (serveJson) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ message: "Not found" }));
      return { props: { responded: true } };
    }

    res.statusCode = 404;
    return {
      props: {
        responded: false,
        missing: true,
        canonicalUrl: buildBundleUrls(req, id).shareUrl,
        ogImageUrl: buildOgImageUrl(req, "root")
      }
    };
  }
}

export default function BundlePage(props) {
  if (props.responded) return null;
  return <ShareBundlePage {...props} />;
}
