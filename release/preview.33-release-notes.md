# Happy Friday Lite 3.0.7.01-preview.33 PDF→Word 修复

本包修复 PDF 无法转换为 Word 的问题：接入本地 PDFium/pdf2docx 管线，支持 OCR、加密 PDF 密码重试、DOCX 输出结构校验，以及覆盖已有 Word 文件时的备份恢复。构建后通过 Electron 启动冒烟测试和 PDF→DOCX 单元测试（13/13）。

安装包未签名，适用于 Windows x64。
