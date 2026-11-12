import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    var serverProcess: Process?
    let appURL = URL(string: "http://localhost:3333")!
    var projectDir: String {
        let permanentDir = "/Users/g/Projects/欣欣/AI错题本"
        if FileManager.default.fileExists(atPath: permanentDir) {
            return permanentDir
        }
        return "/Users/g/.gemini/antigravity/scratch/wrong-notebook"
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMainMenu()
        setupWindow()
        ensureServerAndLoad()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let proc = serverProcess, proc.isRunning {
            proc.terminate()
        }
    }

    private func setupMainMenu() {
        let mainMenu = NSMenu()

        // 1. App Menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于 AI智能错题本", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "隐藏 AI智能错题本", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "显示全部", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "退出 AI智能错题本", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // 2. Edit Menu (required for Cmd+C / Cmd+V / Cmd+A / Undo in WKWebView)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "编辑")
        editMenuItem.submenu = editMenu
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // 3. Tools / View Menu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "操作")
        viewMenuItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "返回首页", action: #selector(goHome), keyEquivalent: "1")
        viewMenu.addItem(withTitle: "刷新页面", action: #selector(reloadPage), keyEquivalent: "r")
        let shotItem = viewMenu.addItem(withTitle: "框选截屏录题", action: #selector(triggerNativeScreenshot), keyEquivalent: "s")
        shotItem.keyEquivalentModifierMask = [.command, .shift]
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "打印 / 导出 PDF…", action: #selector(printCurrentPage), keyEquivalent: "p")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "放大", action: #selector(zoomIn), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "缩小", action: #selector(zoomOut), keyEquivalent: "-")
        viewMenu.addItem(withTitle: "实际大小", action: #selector(resetZoom), keyEquivalent: "0")

        NSApplication.shared.mainMenu = mainMenu
    }

    private func setupWindow() {
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(self, name: "macNative")

        // Bridge window.print() to native macOS Print / PDF sheet
        let bridgeJS = """
        window.print = function() {
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.macNative) {
                window.webkit.messageHandlers.macNative.postMessage({ action: 'print' });
            }
        };
        """
        let script = WKUserScript(source: bridgeJS, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        contentController.addUserScript(script)
        config.userContentController = contentController
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        let rect = NSRect(x: 0, y: 0, width: 1280, height: 840)
        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "AI智能错题本"
        window.center()
        window.setFrameAutosaveName("AIWrongNotebookMainWindow")
        window.minSize = NSSize(width: 900, height: 620)

        webView = WKWebView(frame: rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func ensureServerAndLoad() {
        checkServerReady { [weak self] ready in
            guard let self = self else { return }
            if ready {
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: self.appURL))
                }
            } else {
                DispatchQueue.main.async {
                    self.showLoadingHTML()
                    self.startBackendServer()
                    self.pollUntilServerReady(attemptsLeft: 60)
                }
            }
        }
    }

    private func checkServerReady(completion: @escaping (Bool) -> Void) {
        var req = URLRequest(url: appURL)
        req.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: req) { _, response, error in
            if let http = response as? HTTPURLResponse, error == nil, (200...499).contains(http.statusCode) {
                completion(true)
            } else {
                completion(false)
            }
        }.resume()
    }

    private func showLoadingHTML() {
        let html = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
          body {
            margin: 0; height: 100vh; display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
            background: #f8fafc; color: #0f172a;
          }
          .spinner {
            width: 44px; height: 44px; border: 4px solid #e2e8f0;
            border-top-color: #0f172a; border-radius: 50%;
            animation: spin 0.9s linear infinite; margin-bottom: 20px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
          p { margin: 0; font-size: 14px; color: #64748b; }
        </style>
        </head>
        <body>
          <div class="spinner"></div>
          <h2>正在启动 AI 智能错题本服务…</h2>
          <p>首次启动约需 2~5 秒，请稍候</p>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func startBackendServer() {
        let proc = Process()
        proc.currentDirectoryURL = URL(fileURLWithPath: projectDir)
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-c", "export PATH=\"/Users/g/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH\"; exec npx next dev -p 3333"]
        do {
            try proc.run()
            self.serverProcess = proc
        } catch {
            print("Failed to launch server: \(error)")
        }
    }

    private func pollUntilServerReady(attemptsLeft: Int) {
        guard attemptsLeft > 0 else { return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.6) { [weak self] in
            guard let self = self else { return }
            self.checkServerReady { ready in
                if ready {
                    DispatchQueue.main.async {
                        self.webView.load(URLRequest(url: self.appURL))
                    }
                } else {
                    self.pollUntilServerReady(attemptsLeft: attemptsLeft - 1)
                }
            }
        }
    }

    // MARK: - Actions
    @objc func goHome() {
        webView.load(URLRequest(url: appURL))
    }

    @objc func reloadPage() {
        webView.reload()
    }

    @objc func zoomIn() {
        webView.pageZoom += 0.1
    }

    @objc func zoomOut() {
        webView.pageZoom = max(0.5, webView.pageZoom - 0.1)
    }

    @objc func resetZoom() {
        webView.pageZoom = 1.0
    }

    @objc func printCurrentPage() {
        let printInfo = NSPrintInfo.shared
        printInfo.horizontalPagination = .fit
        printInfo.verticalPagination = .automatic
        printInfo.isHorizontallyCentered = true
        let op = webView.printOperation(with: printInfo)
        op.showsPrintPanel = true
        op.showsProgressPanel = true
        op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
    }

    @objc func triggerNativeScreenshot() {
        let tempPath = "/tmp/wrong_notebook_capture_\(Int(Date().timeIntervalSince1970)).png"
        window.orderOut(nil)
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self = self else { return }
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
            task.arguments = ["-i", "-x", tempPath]
            try? task.run()
            task.waitUntilExit()

            DispatchQueue.main.async {
                self.window.makeKeyAndOrderFront(nil)
                NSApplication.shared.activate(ignoringOtherApps: true)

                if FileManager.default.fileExists(atPath: tempPath),
                   let data = try? Data(contentsOf: URL(fileURLWithPath: tempPath)) {
                    try? FileManager.default.removeItem(atPath: tempPath)
                    let b64 = data.base64EncodedString()
                    let dataUrl = "data:image/png;base64,\(b64)"
                    self.webView.evaluateJavaScript("window.__onMacNativeScreenshot && window.__onMacNativeScreenshot('\(dataUrl)');", completionHandler: nil)
                } else {
                    self.webView.evaluateJavaScript("window.__onMacNativeScreenshot && window.__onMacNativeScreenshot('');", completionHandler: nil)
                }
            }
        }
    }

    // MARK: - WKScriptMessageHandler
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }
        if action == "print" {
            printCurrentPage()
        } else if action == "screenshot" {
            triggerNativeScreenshot()
        }
    }

    // MARK: - WKUIDelegate (File upload, Alert, Confirm, New Window)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in
            if result == .OK {
                completionHandler(panel.urls)
            } else {
                completionHandler(nil)
            }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = "提示"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.beginSheetModal(for: window) { _ in
            completionHandler()
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "确认"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            webView.load(URLRequest(url: url))
        }
        return nil
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
