import { cn } from "@/lib/utils"
import * as React from "react"

export type GeneratedImageLike = {
  src?: string
  base64?: string
  uint8Array?: Uint8Array
  mediaType?: string
}

export type ImageProps = GeneratedImageLike &
  Omit<React.ComponentProps<"img">, "src"> & {
    alt: string
    previewMaxHeight?: number
    previewMaxWidth?: number
  }

const DEFAULT_PREVIEW_MAX_HEIGHT = 160
const DEFAULT_PREVIEW_MAX_WIDTH = 280

function getImageSrc({
  base64,
  mediaType,
}: Pick<GeneratedImageLike, "base64" | "mediaType">) {
  if (base64 && mediaType) {
    return `data:${mediaType};base64,${base64}`
  }
  return undefined
}

export const Image = ({
  src,
  base64,
  uint8Array,
  mediaType = "image/png",
  className,
  alt,
  previewMaxHeight = DEFAULT_PREVIEW_MAX_HEIGHT,
  previewMaxWidth = DEFAULT_PREVIEW_MAX_WIDTH,
  onLoad,
  style,
  ...props
}: ImageProps) => {
  const [objectUrl, setObjectUrl] = React.useState<string | undefined>(undefined)
  const [expanded, setExpanded] = React.useState(false)
  const [canExpand, setCanExpand] = React.useState(false)
  const imageRef = React.useRef<HTMLImageElement | null>(null)

  React.useEffect(() => {
    if (uint8Array && mediaType) {
      const blob = new Blob([uint8Array as BlobPart], { type: mediaType })
      const url = URL.createObjectURL(blob)
      setObjectUrl(url)
      return () => {
        URL.revokeObjectURL(url)
      }
    }
    setObjectUrl(undefined)
    return
  }, [uint8Array, mediaType])

  const base64Src = getImageSrc({ base64, mediaType })
  const imageSrc = src ?? base64Src ?? objectUrl

  const updateCanExpand = React.useCallback((image: HTMLImageElement) => {
    if (previewMaxHeight <= 0 && previewMaxWidth <= 0) {
      setCanExpand(false)
      return
    }

    if (!image.naturalWidth || !image.naturalHeight) {
      setCanExpand(false)
      return
    }

    const widerThanPreview = previewMaxWidth > 0 && image.naturalWidth > previewMaxWidth
    const tallerThanPreview = previewMaxHeight > 0 && image.naturalHeight > previewMaxHeight
    setCanExpand(widerThanPreview || tallerThanPreview)
  }, [previewMaxHeight, previewMaxWidth])

  React.useEffect(() => {
    setExpanded(false)
  }, [imageSrc])

  React.useEffect(() => {
    const image = imageRef.current
    if (!image) return

    updateCanExpand(image)

    if (globalThis.ResizeObserver === undefined) return

    const observer = new ResizeObserver(() => updateCanExpand(image))
    observer.observe(image)
    return () => observer.disconnect()
  }, [imageSrc, updateCanExpand])

  if (!imageSrc) {
    return (
      <div
        aria-label={alt}
        role="img"
        className={cn(
          "h-24 w-40 animate-pulse overflow-hidden rounded-md bg-gray-100 dark:bg-neutral-800",
          className
        )}
        {...props}
      />
    )
  }

  const constrained = previewMaxHeight > 0 || previewMaxWidth > 0
  const previewStyle = !expanded && constrained
    ? {
        ...style,
        ...(previewMaxHeight > 0 ? { maxHeight: previewMaxHeight } : {}),
        ...(previewMaxWidth > 0 ? { maxWidth: previewMaxWidth } : {}),
      }
    : style

  const image = (
    <img
      ref={imageRef}
      src={imageSrc}
      alt={alt}
      className={cn(
        "h-auto w-auto overflow-hidden rounded-md object-contain",
        expanded || !constrained ? "max-w-full" : null,
        className
      )}
      role="img"
      style={previewStyle}
      onLoad={(event) => {
        updateCanExpand(event.currentTarget)
        onLoad?.(event)
      }}
      {...props}
    />
  )

  if (!constrained) {
    return image
  }

  return (
    <div className="inline-flex max-w-full flex-col items-start gap-1">
      <div className="relative inline-block max-w-full overflow-hidden rounded-md">
        {image}
        {!expanded && canExpand ? (
          <div className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/90 to-transparent pb-2 pt-8">
            <button
              type="button"
              className="rounded-full border border-border bg-background/95 px-3 py-1 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
              onClick={() => setExpanded(true)}
            >
              Show full image
            </button>
          </div>
        ) : null}
      </div>
      {expanded && canExpand ? (
        <button
          type="button"
          className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => setExpanded(false)}
        >
          Show less
        </button>
      ) : null}
    </div>
  )
}
