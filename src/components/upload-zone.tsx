"use client";

import { useCallback, useState, useEffect, useRef, useMemo } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, Loader2, Monitor, Plus, Sparkles, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "@/components/ui/toast";

/** Mac 外壳（WKWebView）注入的原生截图桥接 */
type MacBridgeWindow = Window & {
    webkit?: { messageHandlers?: { macNative?: { postMessage: (message: unknown) => void } } };
    __onMacNativeScreenshot?: (dataUrl: string) => void;
};
const macWindow = () => window as MacBridgeWindow;

/** 单批最多识别的图片数，避免一次性占满 AI 额度 */
const MAX_FILES = 20;

/** 用名称 + 大小 + 修改时间去重：同名同大小但内容不同的截图不会再被误判为重复 */
function fileKey(file: File) {
    return `${file.name}-${file.size}-${file.lastModified}`;
}

interface UploadZoneProps {
    onImageSelect: (file: File) => void;
    onBatchImagesSelect?: (files: File[]) => void;
    isAnalyzing: boolean;
}

export function UploadZone({ onImageSelect, onBatchImagesSelect, isAnalyzing }: UploadZoneProps) {
    const { t } = useLanguage();
    const [isScreenshotting, setIsScreenshotting] = useState(false);
    const [isClient, setIsClient] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

    // 确保只在客户端渲染屏幕截图功能。
    // 之前这里在挂载时无用户手势地请求通知权限（且从未使用通知），已移除。
    useEffect(() => {
        setIsClient(true);
    }, []);

    // 预览 URL 按文件对象缓存：新增/删除图片时不再整体重建（之前会导致缩略图闪烁、引用已释放的 URL）
    const previewCache = useRef(new Map<File, string>());
    const previewUrls = useMemo(() => {
        const cache = previewCache.current;
        const urls: Record<string, string> = {};
        selectedFiles.forEach((file) => {
            if (!cache.has(file)) cache.set(file, URL.createObjectURL(file));
            urls[fileKey(file)] = cache.get(file)!;
        });
        // 释放已移除文件的 URL
        for (const [file, url] of cache) {
            if (!selectedFiles.includes(file)) {
                URL.revokeObjectURL(url);
                cache.delete(file);
            }
        }
        return urls;
    }, [selectedFiles]);

    useEffect(() => {
        const cache = previewCache.current;
        return () => {
            cache.forEach((url) => URL.revokeObjectURL(url));
            cache.clear();
        };
    }, []);

    const addFiles = useCallback((newFiles: File[]) => {
        if (!newFiles || newFiles.length === 0) return;
        setSelectedFiles((prev) => {
            const seen = new Set(prev.map(fileKey));
            const unique = newFiles.filter((f) => {
                const key = fileKey(f);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            const combined = [...prev, ...unique];
            if (combined.length > MAX_FILES) {
                toast.info(`一次最多识别 ${MAX_FILES} 张图片，多出的 ${combined.length - MAX_FILES} 张未加入`);
            }
            return combined.slice(0, MAX_FILES);
        });
    }, []);

    const onDrop = useCallback(
        (acceptedFiles: File[], rejected: FileRejection[]) => {
            if (acceptedFiles.length > 0) {
                addFiles(acceptedFiles);
            }
            if (rejected.length > 0) {
                // 之前被拒绝的文件没有任何提示，用户以为「识别不到」
                toast.error(`有 ${rejected.length} 个文件不是支持的图片格式（JPG / PNG / WebP），已忽略`);
            }
        },
        [addFiles]
    );

    const { getRootProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "image/*": [".jpeg", ".jpg", ".png", ".webp"],
        },
        disabled: isAnalyzing,
        noClick: true,
    });

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            addFiles(files);
        }
        e.target.value = "";
    };

    const removeFile = (index: number) => {
        setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
    };

    const clearAllFiles = () => {
        setSelectedFiles([]);
    };

    const handleStartAnalysis = () => {
        if (selectedFiles.length === 0 || isAnalyzing) return;
        if (selectedFiles.length === 1 && onImageSelect) {
            onImageSelect(selectedFiles[0]);
        } else if (onBatchImagesSelect) {
            onBatchImagesSelect(selectedFiles);
        } else {
            onImageSelect(selectedFiles[0]);
        }
    };

    // 监听全局快捷粘贴图片
    useEffect(() => {
        if (typeof window === "undefined") return;

        const handlePaste = (e: ClipboardEvent) => {
            if (isAnalyzing) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            const pastedFiles: File[] = [];
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith("image/")) {
                    const file = items[i].getAsFile();
                    if (file) {
                        pastedFiles.push(file);
                    }
                }
            }
            if (pastedFiles.length > 0) {
                e.preventDefault();
                addFiles(pastedFiles);
            }
        };

        macWindow().__onMacNativeScreenshot = (dataUrl: string) => {
            setIsScreenshotting(false);
            if (!dataUrl) return;
            fetch(dataUrl)
                .then((res) => res.blob())
                .then((blob) => {
                    const file = new File([blob], `screenshot-${Date.now()}.png`, {
                        type: "image/png",
                    });
                    addFiles([file]);
                })
                .catch((err) => {
                    console.warn("Mac screenshot parse error:", err);
                    toast.error("截图读取失败，请重试");
                });
        };

        window.addEventListener("paste", handlePaste);
        return () => {
            window.removeEventListener("paste", handlePaste);
            delete macWindow().__onMacNativeScreenshot;
        };
    }, [isAnalyzing, addFiles]);

    // 检查是否支持屏幕截图
    const isScreenshotSupported = () => {
        if (!isClient || typeof window === "undefined") return false;
        if (macWindow().webkit?.messageHandlers?.macNative) return true;
        return typeof navigator !== "undefined" &&
            "mediaDevices" in navigator &&
            "getDisplayMedia" in navigator.mediaDevices;
    };

    const handleScreenshot = async () => {
        if (!isScreenshotSupported()) {
            toast.error(t.upload.screenshotNotSupported);
            return;
        }

        const macNative = macWindow().webkit?.messageHandlers?.macNative;
        if (macNative) {
            setIsScreenshotting(true);
            macNative.postMessage({ action: "screenshot" });
            return;
        }

        setIsScreenshotting(true);
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false,
            });

            const video = document.createElement("video");
            video.srcObject = stream;
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;

            await new Promise<void>((resolve, reject) => {
                video.onloadedmetadata = () => {
                    video.play().then(() => resolve()).catch(reject);
                };
                video.onerror = reject;
            });

            await new Promise((resolve) => setTimeout(resolve, 500));

            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("无法获取canvas上下文");
            ctx.drawImage(video, 0, 0);

            stream.getTracks().forEach((track) => track.stop());

            canvas.toBlob((blob) => {
                if (blob) {
                    const file = new File([blob], `screenshot-${Date.now()}.png`, {
                        type: "image/png",
                    });
                    addFiles([file]);
                }
            }, "image/png", 1.0);
        } catch (error) {
            // 用户在系统弹窗中取消共享属于正常操作，不提示
            if (error instanceof Error && error.name === "NotAllowedError") return;
            console.warn("Screenshot failed:", error);
            toast.error(t.upload.screenshotFailed || "截图失败");
        } finally {
            setIsScreenshotting(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* 上传区域 */}
            <div {...getRootProps()}>
                <Card
                    className={`relative overflow-hidden border-2 border-dashed transition-all ${
                        isDragActive
                            ? "border-primary bg-primary/5"
                            : selectedFiles.length > 0
                            ? "border-orange-300 dark:border-orange-900 bg-amber-50/20"
                            : "border-muted-foreground/30 hover:border-primary/50"
                    }`}
                >
                    {/* 隐藏的文件输入框 */}
                    <input
                        id="upload-zone-file"
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,image/*"
                        className="hidden"
                        disabled={isAnalyzing}
                        onChange={handleFileChange}
                    />

                    <CardContent className="p-6 flex flex-col items-center justify-center text-center">
                        {/* 状态 1：已有选中的图片队列 */}
                        {selectedFiles.length > 0 ? (
                            <div className="w-full space-y-4">
                                <div className="flex items-center justify-between pb-2 border-b">
                                    <div className="flex items-center gap-2">
                                        <ImageIcon className="w-5 h-5 text-orange-500" />
                                        <span className="font-black text-sm text-foreground">
                                            待分析错题图片队列
                                        </span>
                                        <Badge className="bg-orange-500 text-white font-black text-xs px-2 py-0.5">
                                            已选 {selectedFiles.length} 张
                                        </Badge>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isAnalyzing}
                                            className="text-xs h-8 rounded-xl font-bold cursor-pointer"
                                        >
                                            <Plus className="w-3.5 h-3.5 mr-1" />
                                            继续添加图片
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={clearAllFiles}
                                            disabled={isAnalyzing}
                                            className="text-xs h-8 text-muted-foreground hover:text-red-500 rounded-xl"
                                        >
                                            清空
                                        </Button>
                                    </div>
                                </div>

                                {/* 图片缩略图网格 */}
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[300px] overflow-y-auto p-1">
                                    {selectedFiles.map((file, idx) => {
                                        const key = fileKey(file);
                                        const url = previewUrls[key];
                                        return (
                                            <div
                                                key={key}
                                                className="relative group rounded-2xl overflow-hidden border-2 bg-white dark:bg-slate-800 shadow-sm aspect-square flex items-center justify-center p-1.5"
                                            >
                                                {url ? (
                                                    // eslint-disable-next-line @next/next/no-img-element
                                                    <img
                                                        src={url}
                                                        alt={file.name}
                                                        className="w-full h-full object-contain rounded-xl"
                                                    />
                                                ) : (
                                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                                                )}

                                                <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-md">
                                                    #{idx + 1}
                                                </span>

                                                <button
                                                    type="button"
                                                    aria-label={`移除 ${file.name}`}
                                                    onClick={() => removeFile(idx)}
                                                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500/80 hover:bg-red-600 text-white flex items-center justify-center opacity-80 hover:opacity-100 transition-opacity cursor-pointer shadow"
                                                >
                                                    ✕
                                                </button>

                                                <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[9px] px-1.5 py-0.5 truncate text-center">
                                                    {file.name}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* 开始批量分析按钮 */}
                                <div className="pt-2">
                                    <Button
                                        type="button"
                                        onClick={handleStartAnalysis}
                                        disabled={isAnalyzing}
                                        className="w-full bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 hover:from-orange-600 hover:to-amber-600 text-white font-black text-sm h-11 rounded-2xl shadow-lg transition-transform active:scale-98 cursor-pointer"
                                    >
                                        {isAnalyzing ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                AI 正在批量智能分析题目中...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles className="w-4 h-4 mr-2 fill-white" />
                                                开始识别（共 {selectedFiles.length} 张）
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            /* 状态 2：未选择图片时的上传指引 */
                            <div
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full min-h-[220px] flex flex-col items-center justify-center space-y-3 cursor-pointer py-4"
                            >
                                <div className="rounded-2xl bg-amber-500/10 dark:bg-slate-800 p-4 text-orange-500">
                                    {isAnalyzing ? (
                                        <Loader2 className="h-10 w-10 animate-spin" />
                                    ) : (
                                        <UploadCloud className="h-10 w-10" />
                                    )}
                                </div>

                                <div className="space-y-1">
                                    <h3 className="text-base font-black text-foreground">
                                        点击选择或拖拽图片到这里（支持一次上传多张）
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        支持同时选择多张错题照片或试卷截图，AI 将逐一智能识别考点并生成解答
                                    </p>
                                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-bold pt-1">
                                        提示：可用 Ctrl+V / Cmd+V 直接粘贴截图，也可按住 Shift / Cmd 多选图片
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* 屏幕截图按钮 */}
            {isScreenshotSupported() && (
                <div className="flex items-center justify-center gap-3 pt-1">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleScreenshot}
                        disabled={isAnalyzing || isScreenshotting}
                        className="rounded-2xl text-xs font-bold border-amber-300/80 bg-amber-50/50 hover:bg-amber-100 text-amber-900 dark:text-amber-200 cursor-pointer"
                    >
                        {isScreenshotting ? (
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                            <Monitor className="h-4 w-4 mr-1.5 text-orange-500" />
                        )}
                        <span>框选屏幕截图录题 (快捷键 Cmd+Shift+S)</span>
                    </Button>
                </div>
            )}
        </div>
    );
}
