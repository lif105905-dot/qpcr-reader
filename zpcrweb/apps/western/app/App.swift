import Cocoa
import WebKit
import UniformTypeIdentifiers

/// Western analysis 的本机外壳：只负责开窗、加载单文件 HTML、把导出的文件存到「下载」。
final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    private var pendingDownloads: [ObjectIdentifier: String] = [:]

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()

        let cfg = WKWebViewConfiguration()
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        let controller = WKUserContentController()
        controller.add(self, name: "saveFile")
        controller.add(self, name: "pickFile")
        cfg.userContentController = controller

        web = WKWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        let frame = Self.primaryScreenFrame(1200, 860)
        window = NSWindow(contentRect: frame, styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Western analysis"
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 980, height: 700)
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        loadPage()
    }

    /// 多显示器时 NSScreen.main 可能指向负坐标的外接屏，固定挑原点主屏
    static func primaryScreenFrame(_ w: CGFloat, _ h: CGFloat) -> NSRect {
        let screen = NSScreen.screens.first(where: { $0.frame.origin == .zero }) ?? NSScreen.main ?? NSScreen.screens[0]
        let vis = screen.visibleFrame
        let width = min(w, vis.width - 40)
        let height = min(h, vis.height - 40)
        let x = vis.midX - width / 2
        let y = vis.midY - height / 2
        return NSRect(x: x, y: y, width: width, height: height)
    }

    func loadPage() {
        guard let url = Bundle.main.url(forResource: "WesternAnalysis", withExtension: "html") else {
            let a = NSAlert()
            a.messageText = "缺少页面文件"
            a.informativeText = "App 包里没有 WesternAnalysis.html"
            a.runModal()
            return
        }
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    /// 自检钩子：BLOT_JS=<js 文件> 加载完执行；BLOT_SNAPSHOT=<路径> 写窗口号
    private func runAutomation() {
        let env = ProcessInfo.processInfo.environment
        if let open = env["WA_OPEN"], !open.isEmpty {
            injectFile(URL(fileURLWithPath: (open as NSString).expandingTildeInPath))
        }
        if let snap = env["BLOT_SNAPSHOT"] {
            try? String(window.windowNumber).write(toFile: snap, atomically: true, encoding: .utf8)
        }
        guard let jsPath = env["BLOT_JS"], let js = try? String(contentsOfFile: jsPath, encoding: .utf8) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.web.evaluateJavaScript(js) { result, error in
                if let error = error {
                    try? "JS error: \(error)\n".write(toFile: "/tmp/wa_next_js.log", atomically: true, encoding: .utf8)
                }
                if let result = result {
                    try? "JS result: \(result)\n".write(toFile: "/tmp/wa_next_js.log", atomically: true, encoding: .utf8)
                }
            }
        }
    }

    /// 页面里的 <input type=file>（「打开图片 / 选择文件」按钮背后就是它）在 WKWebView 里
    /// 必须由这个代理弹面板；不实现的话点按钮完全没反应。
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let env = ProcessInfo.processInfo.environment

        // 自检用：WA_AUTOPICK=<路径> 直接返回这个文件，不弹面板
        if let auto = env["WA_AUTOPICK"], !auto.isEmpty {
            let url = URL(fileURLWithPath: (auto as NSString).expandingTildeInPath)
            FileHandle.standardError.write("autopick: \(url.path)\n".data(using: .utf8)!)
            completionHandler([url])
            return
        }

        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.image, .tiff, .png, .jpeg, .bmp, .data]
        panel.message = "选择图像文件（TIFF / PNG / JPG / BMP）"
        panel.prompt = "打开"
        panel.begin { resp in
            completionHandler(resp == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        runAutomation()
    }

    @objc func openImages() {
        // 自检：WA_AUTOPICK 直接注入，不弹面板
        if let auto = ProcessInfo.processInfo.environment["WA_AUTOPICK"], !auto.isEmpty {
            let url = URL(fileURLWithPath: (auto as NSString).expandingTildeInPath)
            FileHandle.standardError.write("autopick: \(url.path)\n".data(using: .utf8)!)
            injectFile(url)
            return
        }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.image, .tiff, .png, .jpeg, .bmp, .data]
        panel.message = "选择图像文件（TIFF / PNG / JPG / BMP）"
        panel.prompt = "打开"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        injectFile(url)
    }

    /// 把本机文件以 File 对象塞进页面（页面在 file:// 下不能直接读别的路径）
    func injectFile(_ url: URL) {
        guard let data = try? Data(contentsOf: url) else { return }
        let b64 = data.base64EncodedString()
        let name = url.lastPathComponent
        let ext = url.pathExtension.lowercased()
        let mime: String
        switch ext {
        case "tif", "tiff": mime = "image/tiff"
        case "png": mime = "image/png"
        case "jpg", "jpeg": mime = "image/jpeg"
        case "bmp": mime = "image/bmp"
        default: mime = "application/octet-stream"
        }
        let js = """
        (function () {
          try {
            var bin = atob("\(b64)");
            var arr = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            var f = new File([arr], "\(name)", { type: "\(mime)" });
            if (!window.WA || !window.WA.app) { window.__waPendingFile = f; return 'pending'; }
            window.WA.app.openFile(f);
            return 'ok';
          } catch (e) { return 'err:' + e.message; }
        })();
        """
        web?.evaluateJavaScript(js) { _, err in
            if let err = err { FileHandle.standardError.write("inject error: \(err)\n".data(using: .utf8)!) }
        }
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 Western analysis", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "文件")
        fileMenu.addItem(withTitle: "打开图片…", action: #selector(openImages), keyEquivalent: "o")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "回到首页", action: #selector(goHome), keyEquivalent: "1")
        fileItem.submenu = fileMenu

        NSApp.mainMenu = main
    }

    @objc func showAbout() {
        let a = NSAlert()
        a.messageText = "Western analysis"
        a.informativeText = "本机离线的 Western blot / 凝胶作图工具。\n所有处理都在本机完成，不联网。"
        a.runModal()
    }

    @objc func goHome() {
        web.evaluateJavaScript("window.WA && WA.app && WA.app.showHome && WA.app.showHome();", completionHandler: nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: - 下载（导出走 <a download>）
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if navigationResponse.canShowMIMEType { decisionHandler(.allow) } else { decisionHandler(.download) }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// 导出：弹原生「存储为」面板，可改文件名、可换文件夹；取消则不写文件。
    /// 自检钩子：WA_SAVE_DIR=<目录> 时跳过面板直接存到该目录（用建议文件名）。
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let fallback = "Western-analysis-export"
        let suggested = suggestedFilename.isEmpty ? fallback : suggestedFilename

        if let dirPath = ProcessInfo.processInfo.environment["WA_SAVE_DIR"] {
            let dir = URL(fileURLWithPath: dirPath, isDirectory: true)
            completionHandler(Self.uniqueURL(in: dir, name: suggested))
            return
        }

        let panel = NSSavePanel()
        panel.title = "导出"
        panel.prompt = "保存"
        panel.canCreateDirectories = true
        panel.nameFieldStringValue = suggested
        panel.allowedFileTypes = nil
        let remembered = UserDefaults.standard.string(forKey: "wa.lastExportDir")
        let startDir = remembered.map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        if let d = startDir { panel.directoryURL = d }

        let finish: (NSApplication.ModalResponse) -> Void = { resp in
            if resp == .OK, let url = panel.url {
                UserDefaults.standard.set(url.deletingLastPathComponent().path, forKey: "wa.lastExportDir")
                completionHandler(url)
            } else {
                completionHandler(nil)   // 取消：WebKit 会把这个下载丢掉，不写文件
            }
        }
        if let win = self.window { panel.beginSheetModal(for: win, completionHandler: finish) }
        else { finish(panel.runModal()) }
    }

    static func uniqueURL(in dir: URL, name: String) -> URL {
        var url = dir.appendingPathComponent(name)
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var i = 2
        while FileManager.default.fileExists(atPath: url.path) {
            let n = ext.isEmpty ? "\(base)-\(i)" : "\(base)-\(i).\(ext)"
            url = dir.appendingPathComponent(n)
            i += 1
        }
        return url
    }

    func downloadDidFinish(_ download: WKDownload) {
        if let url = download.progress.fileURL {
            window.title = "Western analysis — 已导出 \(url.lastPathComponent)"
        }
    }
}

extension AppDelegate: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // 「打开图片」按钮走这里：原生面板选文件后把内容注入页面，
        // 不依赖 WKWebView 对 <input type=file> 的处理
        if message.name == "pickFile" {
            openImages()
            return
        }
        guard let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let dataUrl = body["dataUrl"] as? String, let text = String(dataUrl: dataUrl) else { return }
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        try? text.write(to: dir.appendingPathComponent(name), atomically: true, encoding: .utf8)
    }
}

private extension String {
    init?(dataUrl: String) {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let meta = String(dataUrl[dataUrl.startIndex..<comma])
        let payload = String(dataUrl[dataUrl.index(after: comma)...])
        guard meta.contains("base64"), let data = Data(base64Encoded: payload) else { return nil }
        self.init(data: data, encoding: .utf8)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
