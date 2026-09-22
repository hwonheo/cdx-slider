import Cocoa

// Native preferences are independent of the embedded panel's browser storage.
private func L(_ english: String, _ korean: String) -> String {
    UserDefaults.standard.string(forKey: "sliderLanguage") == "ko" ? korean : english
}

// Independent floating panel: no embedding in, or automation of, the Codex window.
final class SliderBar: NSObject, NSApplicationDelegate {
    var panel: NSPanel!
    var statusItem: NSStatusItem!
    let projects = NSPopUpButton(frame: .zero, pullsDown: false)
    let threads = NSPopUpButton(frame: .zero, pullsDown: false)
    let save = NSButton(title: L("Save", "저장"), target: nil, action: nil)
    let resume = NSButton(title: L("Resume", "불러오기"), target: nil, action: nil)
    let openChat = NSButton(title: "Open CDX Slider", target: nil, action: nil)
    let settings = NSButton(title: "⚙", target: nil, action: nil)
    let link = NSButton(title: L("Link", "연결"), target: nil, action: nil)
    let refresh = NSButton(title: L("Refresh", "새로고침"), target: nil, action: nil)
    let status = NSTextField(labelWithString: L("Connecting…", "연결 중…"))
    let detail = NSTextField(labelWithString: "")
    let transparency = NSSlider(value: 0, minValue: 0, maxValue: 60, target: nil, action: nil)
    let transparencyLabel = NSTextField(labelWithString: L("Transparency 0%", "투명도 0%"))
    let launchHelp = NSButton(title: L("Launch and startup help", "실행 · 자동 실행 안내"), target: nil, action: nil)
    var rows = [[String: Any]](), threadRows = [[String: Any]]()
    var bindings = [String: [String: Any]]()
    var threadLoadGeneration = 0
    var expanded = false, busy = false
    var automaticUpdates = false
    var updateInProgress = false
    var updateTimer: Timer?
    var hostActive = false
    var hostBundleID = "com.openai.codex"
    var process: Process!
    var input: FileHandle!
    var outputBuffer = Data()
    var requestId = 0
    var callbacks = [Int: ([String: Any]?, String?) -> Void]()
    var selectedProject: [String: Any]? { projects.selectedItem?.representedObject as? [String: Any] }
    var selectedKey: String {
        guard let row = selectedProject, let profile = row["profile"] as? String, let id = row["id"] as? String else { return "" }
        return "\(profile)/\(id)"
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        panel = NSPanel(contentRect: NSRect(x: 160, y: 180, width: 470, height: 110), styleMask: [.titled, .closable, .utilityWindow, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "CDX Slider"
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = true
        panel.setFrameAutosaveName("CDXSliderFloatingBar")
        panel.isReleasedWhenClosed = false
        transparency.doubleValue = min(60, max(0, UserDefaults.standard.double(forKey: "barTransparency")))
        transparency.target = self; transparency.action = #selector(changeTransparency)
        transparency.isContinuous = true
        transparency.setAccessibilityLabel(L("Bar transparency", "미니바 투명도"))
        transparency.toolTip = L("0% is opaque; 60% is most transparent. Applies to text and buttons too.", "0%는 불투명, 60%는 가장 투명합니다. 글자와 버튼에도 적용됩니다.")
        transparencyLabel.font = .systemFont(ofSize: 11)
        changeTransparency()
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 470, height: 110))
        panel.contentView = view
        projects.frame = NSRect(x: 10, y: 73, width: 235, height: 27)
        save.frame = NSRect(x: 246, y: 73, width: 68, height: 27)
        resume.frame = NSRect(x: 315, y: 73, width: 88, height: 27)
        settings.frame = NSRect(x: 412, y: 73, width: 44, height: 27)
        openChat.frame = NSRect(x: 220, y: 40, width: 236, height: 27)
        openChat.title = L("Open CDX Slider", "CDX Slider 열기")
        openChat.toolTip = L("Open the CDX Slider control panel directly in Codex.", "Codex에서 CDX Slider 관리 패널을 바로 엽니다.")
        status.frame = NSRect(x: 14, y: 12, width: 438, height: 21)
        status.font = .systemFont(ofSize: 11); status.textColor = .secondaryLabelColor
        status.lineBreakMode = .byTruncatingTail
        for control in [projects, save, resume, settings, openChat, status] as [NSView] { view.addSubview(control) }
        for button in [save,resume,settings,link,refresh,launchHelp,openChat] { button.bezelStyle = .rounded; button.target = self }
        openChat.action = #selector(openChatClicked)
        launchHelp.action = #selector(showLaunchHelp)
        projects.target = self; projects.action = #selector(selectProject)
        save.action = #selector(saveClicked); resume.action = #selector(resumeClicked); settings.action = #selector(toggleSettings)
        link.action = #selector(bindThread); refresh.action = #selector(loadThreads)
        detail.font = .systemFont(ofSize: 11); detail.lineBreakMode = .byTruncatingTail
        for control in [threads,link,refresh,detail,transparency,transparencyLabel,launchHelp] as [NSView] { view.addSubview(control); control.isHidden = true }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "CDX"
        updateLanguageLabels()
        if let data = try? Data(contentsOf: Bundle.main.resourceURL!.appendingPathComponent("runtime.json")),
           let config = try? JSONSerialization.jsonObject(with: data) as? [String:String],
           let identifier = config["hostBundleID"] { hostBundleID = identifier }
        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(self, selector: #selector(hostChanged), name: NSWorkspace.didLaunchApplicationNotification, object: nil)
        center.addObserver(self, selector: #selector(hostChanged), name: NSWorkspace.didTerminateApplicationNotification, object: nil)
        statusItem.isVisible = false
        updateHostState()
    }
    func updateLanguageLabels() {
        save.title = L("Save", "저장"); resume.title = L("Resume", "불러오기")
        link.title = L("Link", "연결"); refresh.title = L("Refresh", "새로고침")
        launchHelp.title = L("Startup help", "실행 · 자동 실행 안내")
        openChat.toolTip = L("Request the CDX Slider panel in the linked chat.", "연결된 채팅에 CDX Slider 패널 열기를 요청합니다.")
        settings.setAccessibilityLabel(L("Settings", "설정"))
        settings.toolTip = L("Link a chat and adjust the bar", "대화 연결 및 미니바 설정")
        projects.setAccessibilityLabel(L("Project", "프로젝트"))
        threads.setAccessibilityLabel(L("Target chat", "대상 대화"))
        transparency.setAccessibilityLabel(L("Bar transparency", "미니바 투명도"))
        transparency.toolTip = L("0% is opaque; 60% is most transparent. Applies to text and buttons too.", "0%는 불투명, 60%는 가장 투명합니다. 글자와 버튼에도 적용됩니다.")
        changeTransparency()
        let menu = NSMenu()
        menu.addItem(withTitle: L("Show bar", "미니바 보기"), action: #selector(showBar), keyEquivalent: "").target = self
        let languageMenu = NSMenu()
        for (title, code) in [("English (EN)", "en"), ("한국어 (KR)", "ko")] {
            let item = languageMenu.addItem(withTitle: title, action: #selector(changeLanguage(_:)), keyEquivalent: "")
            item.target = self; item.representedObject = code
            item.state = (UserDefaults.standard.string(forKey: "sliderLanguage") ?? "en") == code ? .on : .off
        }
        let languageItem = menu.addItem(withTitle: L("Language", "언어"), action: nil, keyEquivalent: "")
        languageItem.submenu = languageMenu
        menu.addItem(withTitle: L("Reset transparency", "투명도 초기화"), action: #selector(resetTransparency), keyEquivalent: "").target = self
        menu.addItem(withTitle: L("Launch and startup help", "실행 · 자동 실행 안내"), action: #selector(showLaunchHelp), keyEquivalent: "").target = self
        menu.addItem(withTitle: L("Quit CDX Slider", "CDX Slider 종료"), action: #selector(quit), keyEquivalent: "q").target = self
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: L("Check for updates…", "업데이트 확인…"), action: #selector(checkForUpdates), keyEquivalent: "").target = self
        let automatic = menu.addItem(withTitle: L("Automatically install updates", "자동 업데이트 설치"), action: #selector(toggleAutomaticUpdates), keyEquivalent: "")
        automatic.target = self; automatic.state = automaticUpdates ? .on : .off
        menu.addItem(withTitle: L("Update status", "업데이트 상태"), action: #selector(showUpdateStatus), keyEquivalent: "").target = self
        statusItem.menu = menu
    }
    @objc func changeLanguage(_ sender: NSMenuItem) {
        guard let code = sender.representedObject as? String, ["en", "ko"].contains(code), !busy else { return }
        UserDefaults.standard.set(code, forKey: "sliderLanguage")
        let selected = selectedKey
        updateLanguageLabels()
        // Re-render only cached state: changing language never sends a work request.
        render(["projects": rows, "bindings": bindings, "selected": selected], nil)
        let selectedThread = threads.selectedItem?.representedObject as? String
        for item in threads.itemArray {
            guard let id = item.representedObject as? String,
                  let row = threadRows.first(where: { $0["id"] as? String == id }) else { continue }
            item.title = "\(row["title"] as? String ?? L("Chat", "대화")) · \(id)"
        }
        if let id = selectedThread, let item = threads.itemArray.first(where: { $0.representedObject as? String == id }) { threads.select(item) }
    }
    @objc func hostChanged(_ notification: Notification) {
        guard let app = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
              app.bundleIdentifier == hostBundleID else { return }
        DispatchQueue.main.async { self.updateHostState() }
    }
    func updateHostState() {
        let running = NSWorkspace.shared.runningApplications.contains { $0.bundleIdentifier == hostBundleID && !$0.isTerminated }
        guard running != hostActive else { return }
        hostActive = running
        statusItem.isVisible = running
        if running {
            startBackend(); request("state") { data,error in self.render(data,error) }
            request("update-status") { data, _ in
                self.automaticUpdates = data?["automatic"] as? Bool ?? false
                self.updateLanguageLabels()
                if data?["restartRequired"] as? Bool == true { self.setStatus(L("Updated. Open a new Codex task; restart Codex if needed.", "업데이트되었습니다. 새 Codex 작업을 열고 필요하면 Codex를 재시작하세요.")) }
                self.runAutomaticUpdate()
            }
            updateTimer?.invalidate()
            updateTimer = Timer.scheduledTimer(withTimeInterval: 3600, repeats: true) { _ in self.runAutomaticUpdate() }
            showBar()
        } else {
            updateTimer?.invalidate(); updateTimer = nil
            panel.orderOut(nil)
            stopBackend()
        }
    }
    func stopBackend() {
        process?.terminationHandler = nil
        // Closing stdin lets the Node backend close its own app-server before exiting.
        try? input?.close(); input = nil
        let previous = process
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { if previous?.isRunning == true { previous?.terminate() } }
        process = nil; callbacks.removeAll(); outputBuffer.removeAll(); busy = false
        projects.isEnabled = true; settings.isEnabled = true
        save.isEnabled = false; resume.isEnabled = false; openChat.isEnabled = false
    }
    func startBackend() {
        guard process?.isRunning != true else { return }
        process = Process()
        let launchedProcess = process!
        let resource = Bundle.main.resourceURL!
        guard let configData = try? Data(contentsOf: resource.appendingPathComponent("runtime.json")), let config = try? JSONSerialization.jsonObject(with: configData) as? [String:String], let node = config["node"], let codex = config["codex"] else { setStatus(L("Could not read runtime settings.", "런타임 설정을 읽지 못했습니다."), error: true); return }
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = [resource.appendingPathComponent("companion.mjs").path]
        var env = ProcessInfo.processInfo.environment; env["CDX_CODEX_BIN"] = codex; env["CDX_SLIDER_INSTALL_ROOT"] = config["installRoot"]; process.environment = env
        let inputPipe = Pipe(), outputPipe = Pipe()
        input = inputPipe.fileHandleForWriting
        process.standardInput = inputPipe; process.standardOutput = outputPipe; process.standardError = FileHandle.nullDevice
        outputPipe.fileHandleForReading.readabilityHandler = { handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async {
                guard self.process === launchedProcess else { return }
                self.outputBuffer.append(bytes)
                while let range = self.outputBuffer.range(of: Data([10])) {
                    let line = self.outputBuffer.subdata(in: 0..<range.lowerBound)
                    self.outputBuffer.removeSubrange(0...range.lowerBound)
                    guard let msg = try? JSONSerialization.jsonObject(with: line) as? [String:Any], let id = msg["id"] as? Int else { continue }
                    self.callbacks.removeValue(forKey: id)?(msg["result"] as? [String:Any],msg["error"] as? String)
                }
            }
        }
        process.terminationHandler = { _ in DispatchQueue.main.async { guard self.process === launchedProcess else { return }; self.setStatus(L("Connection closed. Relaunch the bar.", "연결이 종료되었습니다. 미니바를 다시 실행하세요."), error: true); self.save.isEnabled = false; self.resume.isEnabled = false; self.openChat.isEnabled = false } }
        do { try process.run() } catch { setStatus(L("Could not start backend: \(error.localizedDescription)", "백엔드를 시작하지 못했습니다: \(error.localizedDescription)"), error: true) }
    }
    func request(_ action: String, extra: [String:Any] = [:], completion: @escaping ([String:Any]?,String?) -> Void) {
        guard process?.isRunning == true, let input = input else { completion(nil,L("Backend is not connected", "백엔드 연결 없음")); return }
        requestId += 1
        var message: [String:Any] = ["id": requestId, "action": action, "language": UserDefaults.standard.string(forKey: "sliderLanguage") == "ko" ? "ko" : "en"]
        if let row = selectedProject { message["profile"] = row["profile"]; message["project"] = row["id"] }
        message.merge(extra) { _,new in new }
        callbacks[requestId] = completion
        do { var data = try JSONSerialization.data(withJSONObject: message); data.append(10); try input.write(contentsOf: data) } catch { callbacks.removeValue(forKey: requestId); completion(nil,error.localizedDescription) }
    }
    func setStatus(_ text: String, error: Bool = false) { status.stringValue = text; status.toolTip = text; status.textColor = error ? .systemRed : .secondaryLabelColor }
    func render(_ data: [String:Any]?, _ error: String?) {
        if let error = error { setStatus(error,error:true); return }
        guard let data = data else { return }
        rows = data["projects"] as? [[String:Any]] ?? []; bindings = data["bindings"] as? [String:[String:Any]] ?? [:]
        projects.removeAllItems()
        for row in rows {
            guard let profile = row["profile"] as? String, let id = row["id"] as? String else { continue }
            let name = row["name"] as? String ?? id
            let item = NSMenuItem(title: L("Project: \(name)", "프로젝트: \(name)") + " · \(profile)/\(id)", action: nil, keyEquivalent: "")
            item.representedObject = row
            item.toolTip = L("Profile: \(row["profileLabel"] as? String ?? profile)", "프로필: \(row["profileLabel"] as? String ?? profile)")
            projects.menu?.addItem(item)
        }
        if let selected = data["selected"] as? String,
           let item = projects.itemArray.first(where: {
               guard let row = $0.representedObject as? [String: Any] else { return false }
               return "\(row["profile"] as? String ?? "")/\(row["id"] as? String ?? "")" == selected
           }) { projects.select(item) }
        updateBinding()
    }
    func updateBinding() {
        let binding = bindings[selectedKey]; let title = binding?["title"] as? String
        let description = title.map { L("Linked chat: \($0) · \((binding?["id"] as? String ?? "").suffix(8))", "연결된 대화: \($0) · \((binding?["id"] as? String ?? "").suffix(8))") } ?? L("Link a target chat in Settings.", "⚙에서 대상 대화를 연결하세요.")
        projects.toolTip = description; detail.stringValue = description; detail.toolTip = description
        let canAct = binding != nil && !busy && process?.isRunning == true
        save.isEnabled = canAct; resume.isEnabled = canAct
        openChat.isEnabled = !busy && process?.isRunning == true
        setStatus(rows.isEmpty ? L("No projects registered. Add one in Codex first.", "등록된 프로젝트가 없습니다. Codex에서 먼저 등록하세요.") : description)
    }
    @objc func selectProject() { request("select") { data,error in self.render(data,error); if self.expanded { self.loadThreads() } } }
    @objc func toggleSettings() {
        expanded.toggle()
        let height: CGFloat = expanded ? 240 : 110
        let old = panel.frame; panel.setContentSize(NSSize(width:470,height:height)); panel.setFrameOrigin(NSPoint(x:old.minX,y:old.maxY-panel.frame.height))
        projects.frame.origin.y = height-37; save.frame.origin.y = height-37; resume.frame.origin.y = height-37; settings.frame.origin.y = height-37
        status.frame.origin.y = expanded ? height-68 : 12
        openChat.frame.origin.y = expanded ? 12 : 40
        detail.frame = NSRect(x:14,y:124,width:438,height:20)
        threads.frame = NSRect(x:10,y:89,width:285,height:27)
        link.frame = NSRect(x:297,y:89,width:60,height:27)
        refresh.frame = NSRect(x:359,y:89,width:97,height:27)
        transparencyLabel.frame = NSRect(x:14,y:53,width:122,height:20)
        transparency.frame = NSRect(x:138,y:49,width:313,height:27)
        launchHelp.frame = NSRect(x:10,y:12,width:200,height:27)
        for control in [threads,link,refresh,detail,transparency,transparencyLabel,launchHelp] as [NSView] { control.isHidden = !expanded }
        if expanded { loadThreads() }
    }
    @objc func loadThreads() {
        guard !busy else { return }
        threadLoadGeneration += 1
        let generation = threadLoadGeneration
        let key = selectedKey
        threadRows = []
        threads.removeAllItems(); link.isEnabled = false; setStatus(L("Loading chats…", "대화 목록 조회 중…"))
        request("threads") { data,error in
            guard key == self.selectedKey, generation == self.threadLoadGeneration else { return }
            if let error = error { self.setStatus(error,error:true); return }
            self.threadRows = data?["threads"] as? [[String:Any]] ?? []
            self.threads.removeAllItems()
            for row in self.threadRows {
                guard let id = row["id"] as? String else { continue }
                // NSPopUpButton can coalesce duplicate titles. Keep each menu item unique
                // and bind its identity directly rather than indexing another array.
                self.threads.addItem(withTitle: "\(row["title"] as? String ?? L("Chat", "대화")) · \(id)")
                self.threads.lastItem?.representedObject = id
                self.threads.lastItem?.toolTip = id
            }
            if let id = self.bindings[key]?["id"] as? String, let index = self.threadRows.firstIndex(where: { $0["id"] as? String == id }) { self.threads.selectItem(at:index) }
            self.link.isEnabled = !self.threadRows.isEmpty; self.updateBinding()
        }
    }
    @objc func bindThread() {
        guard !busy, let id = threads.selectedItem?.representedObject as? String else { return }
        threadLoadGeneration += 1
        busy = true; link.isEnabled = false; threads.isEnabled = false; refresh.isEnabled = false; projects.isEnabled = false
        updateBinding()
        request("bind",extra:["threadId":id]) { data,error in
            self.busy = false; self.threads.isEnabled = true; self.refresh.isEnabled = true; self.projects.isEnabled = true
            self.link.isEnabled = !self.threadRows.isEmpty
            if let error = error { self.updateBinding(); self.setStatus(error,error:true); return }
            self.render(data,nil)
        }
    }
    func perform(_ action: String) {
        guard !busy, bindings[selectedKey] != nil else { return }
        // Desktop owns the writer. Hand off the request to its existing conversation.
        let confirm = NSAlert()
        confirm.messageText = L("Copy the request and open the linked chat?", "요청문을 복사하고 연결된 대화를 열까요?")
        confirm.informativeText = L("Chat: \(bindings[selectedKey]?["title"] as? String ?? "")\nID: \(bindings[selectedKey]?["id"] as? String ?? "")\n\nThe request will replace your clipboard contents and the linked chat will open. Paste and send it in the chat to run it.", "대화: \(bindings[selectedKey]?["title"] as? String ?? "")\nID: \(bindings[selectedKey]?["id"] as? String ?? "")\n\n요청문을 클립보드에 복사하고 해당 대화를 엽니다. 채팅 입력란에 붙여넣고 보내면 실행됩니다. 기존 클립보드 내용은 요청문으로 바뀝니다.")
        confirm.addButton(withTitle: L("Copy request and open chat", "요청 복사 · 대화 열기"))
        confirm.addButton(withTitle: L("Cancel", "취소"))
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        busy = true; save.isEnabled = false; resume.isEnabled = false; openChat.isEnabled = false; projects.isEnabled = false; settings.isEnabled = false; link.isEnabled = false
        setStatus(L("Preparing a request for the linked chat…", "연결된 대화의 요청문 준비 중…"))
        request(action) { data,error in
            self.busy = false; self.projects.isEnabled = true; self.settings.isEnabled = true; self.link.isEnabled = !self.threadRows.isEmpty; self.updateBinding()
            if let error = error { self.setStatus(error,error:true); return }
            guard let data = data, data["delivery"] as? String == "clipboard", let prompt = data["prompt"] as? String, let id = data["threadId"] as? String,
                  UUID(uuidString:id) != nil, let url = URL(string:"codex://threads/\(id)") else { self.setStatus(L("Could not verify the open-chat response.", "대화 열기 응답을 확인하지 못했습니다."),error:true); return }
            NSPasteboard.general.clearContents()
            guard NSPasteboard.general.setString(prompt,forType:.string) else { self.setStatus(L("Could not copy the request to the clipboard.", "클립보드에 요청문을 복사하지 못했습니다."),error:true); return }
            if NSWorkspace.shared.open(url) { self.setStatus(data["message"] as? String ?? L("Paste the request in the chat and send it.", "요청문을 채팅에 붙여넣고 보내세요.")) }
            else { self.setStatus(L("Request copied. Open the linked chat in Codex, paste it, and send.", "요청문은 복사했습니다. Codex에서 연결된 대화를 직접 열어 붙여넣고 보내세요."),error:true) }
        }
    }
    @objc func openChatClicked() {
        guard !busy else { return }
        busy = true; updateBinding()
        setStatus(L("Opening CDX Slider…", "CDX Slider 여는 중…"))
        request("panel") { data,error in
            self.busy = false; self.updateBinding()
            if let error = error { self.setStatus(error,error:true); return }
            guard data?["delivery"] as? String == "deeplink",
                  let raw = data?["url"] as? String, let url = URL(string:raw),
                  url.scheme == "codex", url.host == "mcp-app",
                  url.path == "/cdx-slider@personal/slider_home" else {
                self.setStatus(L("Could not verify the panel link.", "패널 링크를 확인하지 못했습니다."),error:true); return
            }
            if NSWorkspace.shared.open(url) {
                self.setStatus(L("Panel opening requested. This does not link a chat.", "패널 열기를 요청했습니다. 대화 연결과는 별개입니다."))
            } else {
                self.setStatus(L("Could not open the panel. Open it from Codex's plugin list.", "패널을 열지 못했습니다. Codex 플러그인 목록에서 열어주세요."),error:true)
            }
        }
    }
    @objc func saveClicked() { perform("save") }
    @objc func resumeClicked() {
        guard !busy, bindings[selectedKey] != nil else { return }
        busy = true; projects.isEnabled = false; settings.isEnabled = false
        threads.isEnabled = false; link.isEnabled = false; refresh.isEnabled = false
        updateBinding(); setStatus(L("Requesting resume from the linked panel…", "연결된 패널에 불러오기 요청 중…"))
        request("relay-resume") { data,error in
            if let error = error { self.finishRelay(error, error:true); return }
            guard let id = data?["requestId"] as? String else { self.finishRelay(L("Could not verify the relay request ID.", "중계 요청 ID를 확인하지 못했습니다."),error:true); return }
            self.pollRelay(id, attempts:0)
        }
    }
    func finishRelay(_ message: String, error: Bool = false) {
        busy = false; projects.isEnabled = true; settings.isEnabled = true
        threads.isEnabled = true; link.isEnabled = !threadRows.isEmpty; refresh.isEnabled = true
        updateBinding(); setStatus(message,error:error)
    }
    func pollRelay(_ id: String, attempts: Int) {
        request("relay-status", extra:["requestId":id]) { data,error in
            if let error = error { self.finishRelay(error,error:true); return }
            let state = data?["status"] as? String ?? "unknown"
            if state == "accepted" {
                self.finishRelay(L("Resume request delivered. Check the response in the chat.", "불러오기 요청을 대화에 전달했습니다. 모델의 답변을 확인하세요.")); return
            }
            if ["rejected","unknown","expired"].contains(state) || attempts >= 22 {
                self.finishRelay(L("Delivery could not be confirmed. Check the chat; the request will not be resent automatically.", "전달 결과를 확인하지 못했습니다. 대화를 확인하세요. 자동 재전송하지 않습니다."),error:true); return
            }
            self.setStatus(state == "dispatching" ? L("Checking message delivery…", "호스트 메시지 전달 확인 중…") : L("Waiting for the linked panel…", "연결된 패널의 수신 대기 중…"))
            DispatchQueue.main.asyncAfter(deadline:.now()+1) {
                guard self.hostActive, self.busy else { return }
                self.pollRelay(id,attempts:attempts+1)
            }
        }
    }
    func updateMessage(_ data: [String:Any]) -> String {
        if let error = data["error"] as? String { return error }
        let version = data["latest"] as? String ?? ""
        switch data["status"] as? String ?? "idle" {
        case "available": return L("Update \(version) is available.", "\(version) 업데이트가 있습니다.")
        case "current": return L("CDX Slider is up to date.", "최신 버전입니다.")
        case "no-release": return L("No stable release has been published yet.", "아직 정식 릴리스가 게시되지 않았습니다.")
        case "updated", "recovered": return L("Update complete. Open a new Codex task; restart Codex if needed.", "업데이트 완료. 새 Codex 작업을 열고 필요하면 Codex를 재시작하세요.")
        case "starting", "checking", "downloading", "building", "installing": return L("Updating CDX Slider…", "CDX Slider 업데이트 중…")
        default: return L("Automatic updates are off until you enable them in the CDX menu.", "CDX 메뉴에서 자동 업데이트를 켤 수 있습니다.")
        }
    }
    @objc func showUpdateStatus() {
        request("update-status") { data, error in
            let alert = NSAlert(); alert.messageText = L("CDX Slider updates", "CDX Slider 업데이트")
            alert.informativeText = error ?? self.updateMessage(data ?? [:]); alert.runModal()
        }
    }
    @objc func toggleAutomaticUpdates() {
        guard !busy else { return }
        let enable = !automaticUpdates
        if enable {
            let alert = NSAlert(); alert.messageText = L("Enable automatic updates?", "자동 업데이트를 켤까요?")
            alert.informativeText = L("CDX Slider will check stable releases every six hours while the bar is running and install them automatically. The bar restarts after installation. Node.js, Git, npm, and Swift tools must remain installed. Codex itself will not restart automatically.", "미니바 실행 중 6시간 간격으로 정식 릴리스를 확인하고 자동 설치합니다. 설치 후 미니바가 재시작됩니다. Node.js, Git, npm, Swift 도구가 필요합니다. Codex 자체는 자동 재시작하지 않습니다.")
            alert.addButton(withTitle: L("Enable", "켜기")); alert.addButton(withTitle: L("Cancel", "취소"))
            guard alert.runModal() == .alertFirstButtonReturn else { return }
        }
        request("update-settings", extra: ["automatic": enable]) { data, error in
            if let error = error { self.setStatus(error, error: true); return }
            self.automaticUpdates = data?["automatic"] as? Bool ?? false; self.updateLanguageLabels()
            self.setStatus(enable ? L("Automatic updates enabled.", "자동 업데이트를 켰습니다.") : L("Automatic updates disabled.", "자동 업데이트를 껐습니다."))
            if enable { self.runAutomaticUpdate() }
        }
    }
    @objc func checkForUpdates() {
        guard !busy else { return }
        busy = true; updateBinding(); setStatus(L("Checking for updates…", "업데이트 확인 중…"))
        request("update-check") { data, error in
            self.busy = false; self.updateBinding()
            if let error = error { self.setStatus(error, error: true); return }
            guard let data = data else { return }
            self.setStatus(self.updateMessage(data))
            if data["status"] as? String == "available" {
                let alert = NSAlert(); alert.messageText = self.updateMessage(data)
                alert.informativeText = L("Install the plugin and bar update now? The bar will restart. Open a new Codex task afterward.", "플러그인과 미니바를 업데이트할까요? 미니바가 재시작됩니다. 완료 후 새 Codex 작업을 여세요.")
                alert.addButton(withTitle: L("Install update", "업데이트 설치")); alert.addButton(withTitle: L("Later", "나중에"))
                if alert.runModal() == .alertFirstButtonReturn { self.startUpdate(automatic: false) }
            }
        }
    }
    func runAutomaticUpdate() { if automaticUpdates && !busy && hostActive { startUpdate(automatic: true) } }
    func startUpdate(automatic: Bool) {
        guard !busy else { return }
        busy = true; updateBinding()
        request(automatic ? "update-auto" : "update-apply") { data, error in
            if let error = error { self.busy = false; self.updateBinding(); self.setStatus(error, error: true); return }
            if data?["status"] as? String != "starting" { self.busy = false; self.updateBinding(); return }
            self.updateInProgress = true
            self.setStatus(L("Updating CDX Slider…", "CDX Slider 업데이트 중…"))
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.pollUpdate() }
        }
    }
    func pollUpdate() {
        guard hostActive && updateInProgress else { return }
        request("update-status") { data, error in
            let state = data?["status"] as? String ?? "failed"
            if error != nil || !["starting", "checking", "downloading", "building", "installing"].contains(state) {
                self.updateInProgress = false; self.busy = false; self.updateBinding()
                self.setStatus(error ?? self.updateMessage(data ?? [:]), error: error != nil || state == "failed"); return
            }
            self.setStatus(self.updateMessage(data ?? [:]))
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.pollUpdate() }
        }
    }
    @objc func changeTransparency() {
        let value = min(60, max(0, transparency.doubleValue.rounded()))
        panel.alphaValue = CGFloat(1 - value / 100)
        transparencyLabel.stringValue = L("Transparency \(Int(value))%", "투명도 \(Int(value))%")
        UserDefaults.standard.set(value, forKey: "barTransparency")
    }
    @objc func resetTransparency() { transparency.doubleValue = 0; changeTransparency(); showBar() }
    @objc func showLaunchHelp() {
        let help = NSAlert()
        help.messageText = L("Running CDX Slider", "CDX Slider 실행 방법")
        help.informativeText = L("The bar appears when Codex launches. When Codex quits, the bar and backend stop; a small watcher remains to detect the next launch.\n\nRegister automatic startup with npm run install:companion in the project. There is no need to add a duplicate login item.\n\nIf you close the window, reopen it from CDX → Show bar. Quit CDX Slider also stops the watcher.\n\nApp location: \(Bundle.main.bundlePath)", "Codex가 실행되면 미니바가 나타나고, Codex가 종료되면 미니바와 백엔드가 내려갑니다. Codex가 없을 때는 실행 알림을 기다리는 작은 감시 프로세스만 남습니다.\n\n자동 연결은 프로젝트의 npm run install:companion 명령으로 등록합니다. 별도로 로그인 항목에 앱을 중복 추가할 필요는 없습니다.\n\n창만 닫았다면 CDX → 미니바 보기로 다시 여세요. ‘CDX Slider 종료’는 자동 연결 감시도 종료합니다.\n\n앱 위치: \(Bundle.main.bundlePath)")
        help.addButton(withTitle: L("OK", "확인")); help.addButton(withTitle: L("Show app in Finder", "Finder에서 앱 보기"))
        if help.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.selectFile(Bundle.main.bundlePath, inFileViewerRootedAtPath: "") }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showBar(); return true }
    @objc func showBar() { if hostActive { panel.orderFrontRegardless() } }
    @objc func quit() { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification: Notification) { NSWorkspace.shared.notificationCenter.removeObserver(self); try? input?.close() }
}
let app = NSApplication.shared
let delegate = SliderBar()
app.delegate = delegate
app.run()
