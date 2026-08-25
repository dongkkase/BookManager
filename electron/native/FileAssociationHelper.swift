import AppKit
import Darwin
import Foundation
import UniformTypeIdentifiers

enum FileAssociationAction: String {
    case status
    case apply
}

struct ErrorPayload: Encodable {
    let code: String
    let message: String
    let domain: String?
    let nativeCode: Int?
}

struct ExtensionResult: Encodable {
    let fileExtension: String
    let contentType: String?
    let defaultApplicationPath: String?
    let defaultApplicationBundleIdentifier: String?
    let matchesAppPath: Bool
    let matchesBundleIdentifier: Bool
    let isDefault: Bool
    let error: ErrorPayload?

    enum CodingKeys: String, CodingKey {
        case fileExtension = "extension"
        case contentType
        case defaultApplicationPath
        case defaultApplicationBundleIdentifier
        case matchesAppPath
        case matchesBundleIdentifier
        case isDefault
        case error
    }
}

struct HelperResponse: Encodable {
    let ok: Bool
    let action: String?
    let appPath: String?
    let appBundleIdentifier: String?
    let results: [ExtensionResult]
    let error: ErrorPayload?
}

final class CompletionState {
    private let lock = NSLock()
    private var completed = false
    private var completionError: Error?

    func complete(error: Error?) {
        lock.lock()
        completionError = error
        completed = true
        lock.unlock()
    }

    func snapshot() -> (completed: Bool, error: Error?) {
        lock.lock()
        defer { lock.unlock() }
        return (completed, completionError)
    }
}

func makeErrorPayload(code: String, message: String) -> ErrorPayload {
    ErrorPayload(code: code, message: message, domain: nil, nativeCode: nil)
}

func makeErrorPayload(code: String, error: Error) -> ErrorPayload {
    let nativeError = error as NSError
    return ErrorPayload(
        code: code,
        message: nativeError.localizedDescription,
        domain: nativeError.domain,
        nativeCode: nativeError.code
    )
}

func emit(_ response: HelperResponse, exitCode: Int32) -> Never {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]

    if let data = try? encoder.encode(response) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    } else {
        let fallback = "{\"error\":{\"code\":\"json_encoding_failed\",\"message\":\"Unable to encode the helper response.\"},\"ok\":false}\n"
        FileHandle.standardOutput.write(Data(fallback.utf8))
    }

    Darwin.exit(exitCode)
}

func fail(
    code: String,
    message: String,
    action: String? = nil,
    appPath: String? = nil
) -> Never {
    emit(
        HelperResponse(
            ok: false,
            action: action,
            appPath: appPath,
            appBundleIdentifier: nil,
            results: [],
            error: makeErrorPayload(code: code, message: message)
        ),
        exitCode: 1
    )
}

func canonicalApplicationURL(_ url: URL) -> URL {
    url.standardizedFileURL.resolvingSymlinksInPath()
}

func normalizeExtensions(_ values: ArraySlice<String>, action: String, appPath: String) -> [String] {
    var normalizedExtensions: [String] = []
    var seen = Set<String>()

    for value in values {
        guard value.hasPrefix("."), value.count > 1 else {
            fail(
                code: "invalid_extension",
                message: "Extensions must include a leading dot: \(value)",
                action: action,
                appPath: appPath
            )
        }

        let extensionBody = String(value.dropFirst())
        guard extensionBody.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) == nil else {
            fail(
                code: "invalid_extension",
                message: "Extension contains unsupported characters: \(value)",
                action: action,
                appPath: appPath
            )
        }

        let normalized = ".\(extensionBody.lowercased())"
        if seen.insert(normalized).inserted {
            normalizedExtensions.append(normalized)
        }
    }

    return normalizedExtensions
}

func currentStatus(
    fileExtension: String,
    contentType: UTType,
    targetApplicationURL: URL,
    targetBundleIdentifier: String,
    error: ErrorPayload? = nil
) -> ExtensionResult {
    let handlerURL = NSWorkspace.shared.urlForApplication(toOpen: contentType)
        .map(canonicalApplicationURL)
    let handlerBundleIdentifier = handlerURL.flatMap { Bundle(url: $0)?.bundleIdentifier }
    let matchesAppPath = handlerURL?.path == targetApplicationURL.path
    let matchesBundleIdentifier = handlerBundleIdentifier == targetBundleIdentifier

    return ExtensionResult(
        fileExtension: fileExtension,
        contentType: contentType.identifier,
        defaultApplicationPath: handlerURL?.path,
        defaultApplicationBundleIdentifier: handlerBundleIdentifier,
        matchesAppPath: matchesAppPath,
        matchesBundleIdentifier: matchesBundleIdentifier,
        isDefault: matchesAppPath || matchesBundleIdentifier,
        error: error
    )
}

func waitForDefaultApplicationChange(
    applicationURL: URL,
    contentType: UTType,
    timeout: TimeInterval = 120
) -> ErrorPayload? {
    let completionState = CompletionState()
    NSWorkspace.shared.setDefaultApplication(at: applicationURL, toOpen: contentType) { error in
        completionState.complete(error: error)
    }

    let deadline = Date(timeIntervalSinceNow: timeout)
    while Date() < deadline {
        let state = completionState.snapshot()
        if state.completed {
            return state.error.map { makeErrorPayload(code: "apply_failed", error: $0) }
        }
        _ = RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
    }

    return makeErrorPayload(
        code: "apply_timeout",
        message: "Timed out while waiting for macOS to update the default application."
    )
}

let arguments = CommandLine.arguments
guard arguments.count >= 4 else {
    fail(
        code: "invalid_arguments",
        message: "Usage: file-association-helper <status|apply> <app-path> <.extension> [.<extension> ...]"
    )
}

let actionValue = arguments[1]
guard let action = FileAssociationAction(rawValue: actionValue) else {
    fail(
        code: "invalid_action",
        message: "Action must be status or apply.",
        action: actionValue
    )
}

let suppliedAppPath = arguments[2]
let applicationURL = canonicalApplicationURL(URL(fileURLWithPath: suppliedAppPath))
var isDirectory: ObjCBool = false
guard FileManager.default.fileExists(atPath: applicationURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue,
      applicationURL.pathExtension.lowercased() == "app",
      let applicationBundle = Bundle(url: applicationURL),
      let applicationBundleIdentifier = applicationBundle.bundleIdentifier else {
    fail(
        code: "invalid_app_path",
        message: "The app path must point to an application bundle with a bundle identifier.",
        action: action.rawValue,
        appPath: applicationURL.path
    )
}

let fileExtensions = normalizeExtensions(
    arguments.dropFirst(3),
    action: action.rawValue,
    appPath: applicationURL.path
)
var results: [ExtensionResult] = []

for fileExtension in fileExtensions {
    let extensionBody = String(fileExtension.dropFirst())
    guard let contentType = UTType(filenameExtension: extensionBody) else {
        results.append(
            ExtensionResult(
                fileExtension: fileExtension,
                contentType: nil,
                defaultApplicationPath: nil,
                defaultApplicationBundleIdentifier: nil,
                matchesAppPath: false,
                matchesBundleIdentifier: false,
                isDefault: false,
                error: makeErrorPayload(
                    code: "content_type_not_found",
                    message: "macOS could not resolve a content type for \(fileExtension)."
                )
            )
        )
        continue
    }

    if action == .apply {
        let applyError = waitForDefaultApplicationChange(
            applicationURL: applicationURL,
            contentType: contentType
        )
        var result = currentStatus(
            fileExtension: fileExtension,
            contentType: contentType,
            targetApplicationURL: applicationURL,
            targetBundleIdentifier: applicationBundleIdentifier,
            error: applyError
        )

        if applyError == nil && !result.isDefault {
            result = currentStatus(
                fileExtension: fileExtension,
                contentType: contentType,
                targetApplicationURL: applicationURL,
                targetBundleIdentifier: applicationBundleIdentifier,
                error: makeErrorPayload(
                    code: "apply_verification_failed",
                    message: "macOS did not report the target application as the default handler."
                )
            )
        }
        results.append(result)
    } else {
        results.append(
            currentStatus(
                fileExtension: fileExtension,
                contentType: contentType,
                targetApplicationURL: applicationURL,
                targetBundleIdentifier: applicationBundleIdentifier
            )
        )
    }
}

let succeeded = results.allSatisfy { $0.error == nil }
emit(
    HelperResponse(
        ok: succeeded,
        action: action.rawValue,
        appPath: applicationURL.path,
        appBundleIdentifier: applicationBundleIdentifier,
        results: results,
        error: nil
    ),
    exitCode: succeeded ? 0 : 1
)
