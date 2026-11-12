"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, Loader2, Monitor, Plus, Trash2, Sparkles, Image as ImageIcon, Crop } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

// 添加 CaptureController 类型声明
declare global {
    interface Window {
        CaptureController: {
            new(): {
                setFocusBehavior(behavior: 'no-focus-change' | 'focus-capturing-application'): void;
            };
        };
    }
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
    const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

    // 确保只在客户端渲染屏幕截图功能
    useEffect(() => {
        setIsClient(true);
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // 管理预览 URL，避免内存泄漏
    useEffect(() => {
        const urls: Record<string, string> = {};
        selectedFiles.forEach((file, idx) => {
            urls[`${file.name}-${file.size}-${idx}`] = URL.createObjectURL(file);
        });
        setPreviewUrls(urls);

        return () => {
            Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
        };
    }, [selectedFiles]);

    const addFiles = useCallback((newFiles: File[]) => {
        if (!newFiles || newFiles.length === 0) return;
        setSelectedFiles((prev) => {
            const combined = [...prev, ...newFiles];
            // 简单去重
            const seen = new Set();
            return combined.filter((f) => {
                const key = `${f.name}-${f.size}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        });
    }, []);

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            if (acceptedFiles.length > 0) {
                addFiles(acceptedFiles);
            }
        },
        [addFiles]
    );

    const { getRootProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            "image/*": [".jpeg", ".jpg", ".png", ".webp"],
        },
        maxFiles: 20,
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

        (window as any).__onMacNativeScreenshot = (dataUrl: string) => {
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
                .catch((err) => console.error("Mac screenshot parse error:", err));
        };

        window.addEventListener("paste", handlePaste);
        return () => {
            window.removeEventListener("paste", handlePaste);
            delete (window as any).__onMacNativeScreenshot;
        };
    }, [isAnalyzing, addFiles]);

    // 检查是否支持屏幕截图
    const isScreenshotSupported = () => {
        if (!isClient || typeof window === "undefined") return false;
        if ((window as any).webkit?.messageHandlers?.macNative) return true;
        return typeof navigator !== "undefined" &&
            "mediaDevices" in navigator &&
            "getDisplayMedia" in navigator.mediaDevices;
    };

    const handleScreenshot = async () => {
        if (!isScreenshotSupported()) {
            alert(t.upload.screenshotNotSupported);
            return;
        }

        if ((window as any).webkit?.messageHandlers?.macNative) {
            setIsScreenshotting(true);
            (window as any).webkit.messageHandlers.macNative.postMessage({
                action: "screenshot",
            });
            return;
        }

        setIsScreenshotting(true);
        try {
            let controller;
            if ("CaptureController" in window) {
                controller = new window.CaptureController();
            }

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
            console.error("Screenshot failed:", error);
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
                                        const key = `${file.name}-${file.size}-${idx}`;
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
                                                开始智能分析 (共 {selectedFiles.length} 张图片) 🚀
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
                                        💡 提示：支持 Ctrl+V / Cmd+V 直接粘贴截图，也支持按住 Shift / Cmd 多选图片！
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
