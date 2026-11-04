import * as React from 'react'
import {
  RotateCw,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Check,
  Circle,
  Square,
  Move,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ImageCropperModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  imageSrc: string | null
  onCropComplete: (croppedDataUrl: string, croppedFile: File) => void
  initialShape?: 'circle' | 'square'
  outputSize?: number
  title?: string
}

const VIEWPORT_SIZE = 260
const CONTAINER_SIZE = 340

export const ImageCropperModal: React.FC<ImageCropperModalProps> = ({
  open,
  onOpenChange,
  imageSrc,
  onCropComplete,
  initialShape = 'circle',
  outputSize = 512,
  title = 'Crop Image',
}) => {
  const [zoom, setZoom] = React.useState<number>(1)
  const [pan, setPan] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [rotation, setRotation] = React.useState<number>(0)
  const [shape, setShape] = React.useState<'circle' | 'square'>(initialShape)
  const [isDragging, setIsDragging] = React.useState(false)
  const dragStartRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const imageRef = React.useRef<HTMLImageElement | null>(null)

  // Reset state when a new image is loaded or modal re-opens
  React.useEffect(() => {
    if (open) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      setRotation(0)
      setShape(initialShape)
    }
  }, [open, imageSrc, initialShape])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      setIsDragging(true)
      dragStartRef.current = {
        x: touch.clientX - pan.x,
        y: touch.clientY - pan.y,
      }
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return
    const touch = e.touches[0]
    setPan({
      x: touch.clientX - dragStartRef.current.x,
      y: touch.clientY - dragStartRef.current.y,
    })
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    setZoom((prev) => Math.min(3, Math.max(0.5, Number((prev + delta).toFixed(2)))))
  }

  const handleReset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setRotation(0)
  }

  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360)
  }

  const handleApplyCrop = () => {
    if (!imageRef.current) return
    const img = imageRef.current

    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // High quality scaling
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // If circle shape, clip to circular path
    if (shape === 'circle') {
      ctx.beginPath()
      ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
    }

    // Scale factor from preview viewport to final output canvas
    const scaleFactor = outputSize / VIEWPORT_SIZE

    // Center of canvas
    ctx.translate(outputSize / 2, outputSize / 2)

    // Apply pan (scaled up to canvas size)
    ctx.translate(pan.x * scaleFactor, pan.y * scaleFactor)

    // Apply rotation
    ctx.rotate((rotation * Math.PI) / 180)

    // Apply zoom
    ctx.scale(zoom * scaleFactor, zoom * scaleFactor)

    // Compute drawing dimensions to fit image naturally within viewport at zoom=1
    const imgAspect = img.naturalWidth / img.naturalHeight
    let drawWidth = VIEWPORT_SIZE
    let drawHeight = VIEWPORT_SIZE
    if (imgAspect > 1) {
      drawWidth = VIEWPORT_SIZE * imgAspect
      drawHeight = VIEWPORT_SIZE
    } else {
      drawWidth = VIEWPORT_SIZE
      drawHeight = VIEWPORT_SIZE / imgAspect
    }

    // Draw image centered
    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)

    const croppedDataUrl = canvas.toDataURL('image/png')

    canvas.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `company_logo_${Date.now()}.png`, {
        type: 'image/png',
      })
      onCropComplete(croppedDataUrl, file)
      onOpenChange(false)
    }, 'image/png')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] w-full p-5 sm:p-6 rounded-[24px] bg-white border border-stroke/30 shadow-2xl">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg sm:text-xl font-bold text-focus">
              {title}
            </DialogTitle>
            <div className="flex items-center gap-1 bg-surface p-1 rounded-xl border border-stroke/30">
              <button
                type="button"
                onClick={() => setShape('circle')}
                className={cn(
                  'h-7 px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer',
                  shape === 'circle'
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-muted-fg hover:text-focus'
                )}
                title="Circular Crop"
              >
                <Circle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Circle</span>
              </button>
              <button
                type="button"
                onClick={() => setShape('square')}
                className={cn(
                  'h-7 px-2 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer',
                  shape === 'square'
                    ? 'bg-white text-primary shadow-xs'
                    : 'text-muted-fg hover:text-focus'
                )}
                title="Square Crop"
              >
                <Square className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Square</span>
              </button>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-fg">
            Drag to reposition. Use zoom and rotation to frame the company logo perfectly.
          </DialogDescription>
        </DialogHeader>

        {/* Interactive Cropper Canvas Area */}
        <div className="relative mx-auto mt-2 flex items-center justify-center select-none overflow-hidden rounded-2xl bg-slate-900 border border-slate-700 shadow-inner">
          <div
            className="relative cursor-grab active:cursor-grabbing overflow-hidden flex items-center justify-center"
            style={{ width: CONTAINER_SIZE, height: CONTAINER_SIZE }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleMouseUp}
            onWheel={handleWheel}
          >
            {/* Underlying Scalable & Pannable Image */}
            {imageSrc && (
              <img
                ref={imageRef}
                src={imageSrc}
                alt="Source preview"
                draggable={false}
                className="pointer-events-none absolute max-w-none transition-transform duration-75 select-none"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
                  transformOrigin: 'center center',
                  maxHeight: `${VIEWPORT_SIZE}px`,
                  minHeight: `${VIEWPORT_SIZE}px`,
                  objectFit: 'contain',
                }}
              />
            )}

            {/* Dark Mask Overlay with Cutout */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <svg
                width={CONTAINER_SIZE}
                height={CONTAINER_SIZE}
                viewBox={`0 0 ${CONTAINER_SIZE} ${CONTAINER_SIZE}`}
                className="absolute inset-0"
              >
                <defs>
                  <mask id="crop-mask">
                    {/* Fill white (opaque) */}
                    <rect width="100%" height="100%" fill="white" />
                    {/* Cutout black (transparent) */}
                    {shape === 'circle' ? (
                      <circle
                        cx={CONTAINER_SIZE / 2}
                        cy={CONTAINER_SIZE / 2}
                        r={VIEWPORT_SIZE / 2}
                        fill="black"
                      />
                    ) : (
                      <rect
                        x={(CONTAINER_SIZE - VIEWPORT_SIZE) / 2}
                        y={(CONTAINER_SIZE - VIEWPORT_SIZE) / 2}
                        width={VIEWPORT_SIZE}
                        height={VIEWPORT_SIZE}
                        rx="16"
                        fill="black"
                      />
                    )}
                  </mask>
                </defs>
                {/* Semi-transparent dark overlay covering outside the crop area */}
                <rect
                  width="100%"
                  height="100%"
                  fill="rgba(15, 23, 42, 0.72)"
                  mask="url(#crop-mask)"
                />
              </svg>

              {/* Viewport Boundary & Rule of Thirds Guides */}
              <div
                className={cn(
                  'pointer-events-none absolute border-2 border-white/80 shadow-2xl transition-all',
                  shape === 'circle' ? 'rounded-full' : 'rounded-2xl'
                )}
                style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
              >
                {/* Faint grid lines */}
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-25">
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-r border-b border-white" />
                  <div className="border-b border-white" />
                  <div className="border-r border-white" />
                  <div className="border-r border-white" />
                  <div />
                </div>
              </div>
            </div>

            {/* Move Hint */}
            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white/90 backdrop-blur-xs">
              <Move className="h-3 w-3" />
              <span>Drag to move</span>
            </div>
          </div>
        </div>

        {/* Cropper Toolbar Controls */}
        <div className="mt-4 space-y-3">
          {/* Zoom Slider */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(1))))}
              className="h-8 w-8 p-0 text-muted-fg hover:text-focus cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(parseFloat(e.target.value))}
              className="flex-1 accent-primary h-1.5 bg-slate-200 rounded-lg cursor-pointer"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.1).toFixed(1))))}
              className="h-8 w-8 p-0 text-muted-fg hover:text-focus cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <span className="text-xs font-semibold text-focus w-10 text-right select-none">
              {Math.round(zoom * 100)}%
            </span>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center justify-between pt-1 border-t border-stroke/20">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRotate}
                className="h-8 px-2.5 rounded-lg text-xs font-medium text-focus hover:bg-surface border-stroke/40 cursor-pointer flex items-center gap-1.5"
                title="Rotate 90 degrees"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>Rotate</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-8 px-2.5 rounded-lg text-xs font-medium text-muted-fg hover:text-focus cursor-pointer flex items-center gap-1"
                title="Reset crop"
              >
                <RefreshCw className="h-3 w-3" />
                <span>Reset</span>
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="h-9 px-3.5 rounded-xl text-xs font-semibold text-focus hover:bg-surface border-stroke/50 cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleApplyCrop}
                className="h-9 px-4 rounded-xl bg-[#960C01] hover:bg-[#800a01] text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Apply Crop</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
