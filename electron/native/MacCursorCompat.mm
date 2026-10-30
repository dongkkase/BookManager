#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>
#include <cmath>
#include <cstring>

@class BMCursorState;

@interface BMCursorOverlay : NSView
@property(nonatomic, weak) BMCursorState *cursorState;
@property(nonatomic, strong) NSTrackingArea *cursorTrackingArea;
@end

@interface BMCursorState : NSObject
@property(nonatomic, weak) NSWindow *targetWindow;
@property(nonatomic, weak) NSView *contentView;
@property(nonatomic, strong) BMCursorOverlay *overlay;
@property(nonatomic, strong) NSImage *cursorImage;
@property(nonatomic, copy) NSString *cursorType;
@property(nonatomic) NSPoint hotspot;
@property(nonatomic) NSPoint point;
@property(nonatomic) BOOL attached;
@property(nonatomic) BOOL suspended;
@property(nonatomic) BOOL sheetSuspended;
@property(nonatomic) BOOL resizeSuspended;
@property(nonatomic) BOOL dragSuspended;
@property(nonatomic) BOOL supported;
@property(nonatomic) BOOL ownsHide;
@property(nonatomic) NSUInteger hideCount;
@property(nonatomic) NSUInteger unhideCount;
- (NSRect)imageRect;
- (void)refresh;
- (void)restore;
- (void)detach;
@end

static NSMutableDictionary<NSNumber *, BMCursorState *> *states;
static __weak BMCursorState *activeState;
static id eventMonitor;
static NSMutableArray *notificationObservers;
static NSUInteger menuDepth = 0;

@implementation BMCursorOverlay
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return NO; }
- (BOOL)acceptsFirstResponder { return NO; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSView *)hitTest:(NSPoint)point { return nil; }

- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    if (self.cursorTrackingArea) [self removeTrackingArea:self.cursorTrackingArea];
    self.cursorTrackingArea = [[NSTrackingArea alloc] initWithRect:NSZeroRect
        options:NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
        owner:self userInfo:nil];
    [self addTrackingArea:self.cursorTrackingArea];
}

- (void)mouseEntered:(NSEvent *)event { [self.cursorState refresh]; }
- (void)mouseExited:(NSEvent *)event { [self.cursorState restore]; }

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    if (!self.window) [self.cursorState restore];
}

- (void)drawRect:(NSRect)dirtyRect {
    [NSColor.clearColor setFill];
    NSRectFillUsingOperation(dirtyRect, NSCompositingOperationCopy);
    BMCursorState *state = self.cursorState;
    if (!state.ownsHide || !state.cursorImage) return;
    [state.cursorImage drawInRect:state.imageRect fromRect:NSZeroRect
        operation:NSCompositingOperationSourceOver fraction:1 respectFlipped:YES hints:nil];
}
@end

@implementation BMCursorState
- (NSRect)imageRect {
    NSSize size = self.cursorImage.size;
    return NSMakeRect(self.point.x - self.hotspot.x, self.point.y - self.hotspot.y, size.width, size.height);
}

- (void)restore {
    if (!self.ownsHide) return;
    NSRect oldRect = self.imageRect;
    self.ownsHide = NO;
    [NSCursor unhide];
    self.unhideCount += 1;
    [self.overlay setNeedsDisplayInRect:NSInsetRect(oldRect, -2, -2)];
    if (activeState == self) activeState = nil;
}

- (void)refresh {
    NSWindow *window = self.targetWindow;
    NSView *content = self.contentView;
    if (self.dragSuspended && NSEvent.pressedMouseButtons == 0) self.dragSuspended = NO;
    if (!self.attached || !content || !window || !self.supported || self.suspended
        || self.sheetSuspended || self.resizeSuspended || self.dragSuspended || menuDepth > 0
        || !NSApp.active || NSApp.hidden || !window.keyWindow || !window.visible
        || window.miniaturized || window.attachedSheet || NSApp.modalWindow
        || !(window.occlusionState & NSWindowOcclusionStateVisible)
        || self.overlay.window != window) {
        [self restore];
        return;
    }
    NSPoint location = [window convertPointFromScreen:NSEvent.mouseLocation];
    NSPoint point = [self.overlay convertPoint:location fromView:nil];
    if (!NSMouseInRect(point, self.overlay.visibleRect, YES)) {
        [self restore];
        return;
    }
    if (content.subviews.lastObject != self.overlay) {
        [content addSubview:self.overlay positioned:NSWindowAbove relativeTo:nil];
    }
    NSRect oldRect = self.ownsHide ? self.imageRect : NSZeroRect;
    self.point = point;
    if (activeState && activeState != self) [activeState restore];
    if (!self.ownsHide) {
        [NSCursor hide];
        self.ownsHide = YES;
        self.hideCount += 1;
    }
    activeState = self;
    NSRect dirtyRect = NSUnionRect(oldRect, self.imageRect);
    [self.overlay setNeedsDisplayInRect:NSInsetRect(dirtyRect, -2, -2)];
}

- (void)detach {
    [self restore];
    self.attached = NO;
    self.overlay.cursorState = nil;
    [self.overlay removeFromSuperview];
    self.overlay = nil;
    self.contentView = nil;
    self.targetWindow = nil;
}
@end

static void refreshStates(void) {
    for (BMCursorState *state in states.allValues) [state refresh];
}

static void restoreStates(void) {
    for (BMCursorState *state in states.allValues) [state restore];
}

static void refreshAfterEvent(void) {
    dispatch_async(dispatch_get_main_queue(), ^{ refreshStates(); });
}

static void addObserver(NSNotificationName name, void (^handler)(NSNotification *)) {
    id observer = [NSNotificationCenter.defaultCenter addObserverForName:name object:nil queue:nil usingBlock:handler];
    [notificationObservers addObject:observer];
}

static void installObservers(void) {
    if (eventMonitor) return;
    notificationObservers = [NSMutableArray array];
    NSEventMask mouseEvents = NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged
        | NSEventMaskRightMouseDragged | NSEventMaskOtherMouseDragged
        | NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown
        | NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp | NSEventMaskOtherMouseUp;
    eventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mouseEvents handler:^NSEvent *(NSEvent *event) {
        BOOL dragging = event.type == NSEventTypeLeftMouseDragged
            || event.type == NSEventTypeRightMouseDragged || event.type == NSEventTypeOtherMouseDragged;
        for (BMCursorState *state in states.allValues) {
            if (event.window == state.targetWindow) {
                // Native drag sessions bypass local mouse monitoring, so release before they start.
                if (dragging) state.dragSuspended = YES;
                [state refresh];
            } else [state restore];
        }
        if (event.type == NSEventTypeLeftMouseUp || event.type == NSEventTypeRightMouseUp
            || event.type == NSEventTypeOtherMouseUp) refreshAfterEvent();
        return event;
    }];
    for (NSNotificationName name in @[
        NSApplicationDidResignActiveNotification, NSApplicationDidHideNotification,
        NSApplicationWillTerminateNotification,
    ]) addObserver(name, ^(NSNotification *notification) { restoreStates(); });
    for (NSNotificationName name in @[NSApplicationDidBecomeActiveNotification, NSApplicationDidUnhideNotification]) {
        addObserver(name, ^(NSNotification *notification) { refreshAfterEvent(); });
    }
    for (NSNotificationName name in @[
        NSWindowDidResignKeyNotification, NSWindowWillMiniaturizeNotification,
        NSWindowWillMoveNotification,
    ]) addObserver(name, ^(NSNotification *notification) {
        for (BMCursorState *state in states.allValues) {
            if (state.targetWindow == notification.object) [state restore];
        }
    });
    for (NSNotificationName name in @[
        NSWindowDidBecomeKeyNotification, NSWindowDidDeminiaturizeNotification,
        NSWindowDidChangeOcclusionStateNotification, NSWindowDidMoveNotification,
        NSWindowDidResizeNotification, NSWindowDidChangeBackingPropertiesNotification,
    ]) addObserver(name, ^(NSNotification *notification) {
        for (BMCursorState *state in states.allValues) {
            if (state.targetWindow == notification.object) [state refresh];
        }
    });
    addObserver(NSWindowWillCloseNotification, ^(NSNotification *notification) {
        for (BMCursorState *state in states.allValues) {
            if (state.targetWindow == notification.object) [state detach];
        }
    });
    addObserver(NSWindowWillBeginSheetNotification, ^(NSNotification *notification) {
        for (BMCursorState *state in states.allValues) {
            if (state.targetWindow != notification.object) continue;
            state.sheetSuspended = YES;
            [state restore];
        }
    });
    addObserver(NSWindowDidEndSheetNotification, ^(NSNotification *notification) {
        for (BMCursorState *state in states.allValues) {
            if (state.targetWindow == notification.object) state.sheetSuspended = NO;
        }
        refreshAfterEvent();
    });
    addObserver(NSWindowWillStartLiveResizeNotification, ^(NSNotification *notification) {
        for (BMCursorState *state in states.allValues) {
            if (state.targetWindow != notification.object) continue;
            state.resizeSuspended = YES;
            [state restore];
        }
    });
    addObserver(NSWindowDidEndLiveResizeNotification, ^(NSNotification *notification) {
        for (BMCursorState *state in states.allValues) {
            if (state.targetWindow == notification.object) state.resizeSuspended = NO;
        }
        refreshAfterEvent();
    });
    addObserver(NSMenuDidBeginTrackingNotification, ^(NSNotification *notification) {
        menuDepth += 1;
        restoreStates();
    });
    addObserver(NSMenuDidEndTrackingNotification, ^(NSNotification *notification) {
        if (menuDepth > 0) menuDepth -= 1;
        refreshAfterEvent();
    });
}

static void uninstallObservers(void) {
    if (eventMonitor) [NSEvent removeMonitor:eventMonitor];
    eventMonitor = nil;
    for (id observer in notificationObservers) [NSNotificationCenter.defaultCenter removeObserver:observer];
    notificationObservers = nil;
    menuDepth = 0;
}

static NSCursor *nativeCursor(NSString *type) {
    if ([@[@"pointer", @"default", @"null"] containsObject:type]) return NSCursor.arrowCursor;
    if ([type isEqualToString:@"hand"]) return NSCursor.pointingHandCursor;
    if ([type isEqualToString:@"text"]) return NSCursor.IBeamCursor;
    if ([type isEqualToString:@"vertical-text"]) return NSCursor.IBeamCursorForVerticalLayout;
    if ([@[@"crosshair", @"cell"] containsObject:type]) return NSCursor.crosshairCursor;
    if ([type isEqualToString:@"grab"]) return NSCursor.openHandCursor;
    if ([type isEqualToString:@"grabbing"]) return NSCursor.closedHandCursor;
    if ([@[@"copy", @"drag-drop-copy"] containsObject:type]) return NSCursor.dragCopyCursor;
    if ([@[@"alias", @"drag-drop-link"] containsObject:type]) return NSCursor.dragLinkCursor;
    if ([type isEqualToString:@"context-menu"]) return NSCursor.contextualMenuCursor;
    if ([@[@"not-allowed", @"nodrop", @"drag-drop-none", @"ns-no-resize", @"ew-no-resize", @"nesw-no-resize", @"nwse-no-resize"] containsObject:type]) {
        return NSCursor.operationNotAllowedCursor;
    }
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 150000
    if (@available(macOS 15.0, *)) {
        if ([type isEqualToString:@"zoom-in"]) return NSCursor.zoomInCursor;
        if ([type isEqualToString:@"zoom-out"]) return NSCursor.zoomOutCursor;
        if ([type isEqualToString:@"col-resize"]) return NSCursor.columnResizeCursor;
        if ([type isEqualToString:@"row-resize"]) return NSCursor.rowResizeCursor;
        NSDictionary *positions = @{
            @"e-resize": @(NSCursorFrameResizePositionRight), @"w-resize": @(NSCursorFrameResizePositionLeft),
            @"n-resize": @(NSCursorFrameResizePositionTop), @"s-resize": @(NSCursorFrameResizePositionBottom),
            @"ne-resize": @(NSCursorFrameResizePositionTopRight), @"nw-resize": @(NSCursorFrameResizePositionTopLeft),
            @"se-resize": @(NSCursorFrameResizePositionBottomRight), @"sw-resize": @(NSCursorFrameResizePositionBottomLeft),
            @"ns-resize": @(NSCursorFrameResizePositionTop), @"ew-resize": @(NSCursorFrameResizePositionRight),
            @"nesw-resize": @(NSCursorFrameResizePositionTopRight), @"nwse-resize": @(NSCursorFrameResizePositionTopLeft),
        };
        NSNumber *position = positions[type];
        BOOL bidirectional = [@[@"ns-resize", @"ew-resize", @"nesw-resize", @"nwse-resize"] containsObject:type];
        if (position) return [NSCursor frameResizeCursorFromPosition:(NSCursorFrameResizePosition)position.unsignedIntegerValue
            inDirections:bidirectional ? NSCursorFrameResizeDirectionsAll : NSCursorFrameResizeDirectionsOutward];
    } else
#endif
    {
        if ([@[@"col-resize", @"e-resize", @"w-resize", @"ew-resize"] containsObject:type]) return NSCursor.resizeLeftRightCursor;
        if ([@[@"row-resize", @"n-resize", @"s-resize", @"ns-resize"] containsObject:type]) return NSCursor.resizeUpDownCursor;
    }
    return nil;
}

static napi_value jsUndefined(napi_env env) {
    napi_value value;
    napi_get_undefined(env, &value);
    return value;
}

static void boolProperty(napi_env env, napi_value object, const char *name, BOOL flag) {
    napi_value value;
    napi_get_boolean(env, flag, &value);
    napi_set_named_property(env, object, name, value);
}

static void numberProperty(napi_env env, napi_value object, const char *name, double number) {
    napi_value value;
    napi_create_double(env, number, &value);
    napi_set_named_property(env, object, name, value);
}

static void stringProperty(napi_env env, napi_value object, const char *name, NSString *string) {
    napi_value value;
    napi_create_string_utf8(env, (string ?: @"").UTF8String, NAPI_AUTO_LENGTH, &value);
    napi_set_named_property(env, object, name, value);
}

static napi_value inspectState(napi_env env, BMCursorState *state) {
    napi_value result;
    napi_create_object(env, &result);
    boolProperty(env, result, "attached", state.attached);
    boolProperty(env, result, "active", state.ownsHide);
    boolProperty(env, result, "ownsHide", state.ownsHide);
    boolProperty(env, result, "overlayVisible", state.ownsHide && state.cursorImage != nil);
    boolProperty(env, result, "suspended", state.suspended);
    boolProperty(env, result, "sheetSuspended", state.sheetSuspended);
    boolProperty(env, result, "dragSuspended", state.dragSuspended);
    boolProperty(env, result, "supported", state.supported);
    boolProperty(env, result, "nativeOverlayHitTransparent", state.overlay == nil || [state.overlay hitTest:state.point] == nil);
    numberProperty(env, result, "hideCount", state.hideCount);
    numberProperty(env, result, "unhideCount", state.unhideCount);
    numberProperty(env, result, "menuDepth", menuDepth);
    stringProperty(env, result, "cursorType", state.cursorType);
    napi_value point;
    napi_create_object(env, &point);
    numberProperty(env, point, "x", state.point.x);
    numberProperty(env, point, "y", state.point.y);
    napi_set_named_property(env, result, "point", point);
    napi_value hotspot;
    napi_create_object(env, &hotspot);
    numberProperty(env, hotspot, "x", state.hotspot.x);
    numberProperty(env, hotspot, "y", state.hotspot.y);
    napi_set_named_property(env, result, "hotspot", hotspot);
    napi_value size;
    napi_create_object(env, &size);
    numberProperty(env, size, "width", state.cursorImage.size.width);
    numberProperty(env, size, "height", state.cursorImage.size.height);
    napi_set_named_property(env, result, "imageSize", size);
    return result;
}

static BOOL mainThread(napi_env env) {
    if (NSThread.isMainThread) return YES;
    napi_throw_error(env, nullptr, "MacCursorCompat must run on the Electron main thread");
    return NO;
}

static NSNumber *windowId(napi_env env, napi_value value) {
    double number = 0;
    if (napi_get_value_double(env, value, &number) != napi_ok || !std::isfinite(number)
        || number < 1 || number > 9007199254740991.0 || std::floor(number) != number) {
        napi_throw_type_error(env, nullptr, "Window id must be a positive integer");
        return nil;
    }
    return @((unsigned long long)number);
}

static napi_value attach(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        if (!mainThread(env)) return nullptr;
        size_t argc = 2;
        napi_value argv[2];
        napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
        void *bytes = nullptr;
        size_t length = 0;
        if (argc < 2 || napi_get_buffer_info(env, argv[0], &bytes, &length) != napi_ok || length != sizeof(void *)) {
            napi_throw_type_error(env, nullptr, "attach expects a native window handle Buffer and window id");
            return nullptr;
        }
        NSNumber *identifier = windowId(env, argv[1]);
        if (!identifier) return nullptr;
        void *pointer = nullptr;
        memcpy(&pointer, bytes, sizeof(pointer));
        if (!pointer) {
            napi_throw_type_error(env, nullptr, "Native window handle must not be null");
            return nullptr;
        }
        id object = (__bridge id)pointer;
        NSView *content = [object isKindOfClass:NSWindow.class] ? ((NSWindow *)object).contentView
            : [object isKindOfClass:NSView.class] ? object : nil;
        if (!content.window) {
            napi_throw_type_error(env, nullptr, "Native window handle must reference an attached NSView");
            return nullptr;
        }
        if (!states) states = [NSMutableDictionary dictionary];
        [states[identifier] detach];
        BMCursorState *state = [[BMCursorState alloc] init];
        state.contentView = content;
        state.targetWindow = content.window;
        state.attached = YES;
        state.supported = YES;
        state.cursorType = @"pointer";
        state.cursorImage = NSCursor.arrowCursor.image;
        state.hotspot = NSCursor.arrowCursor.hotSpot;
        state.overlay = [[BMCursorOverlay alloc] initWithFrame:content.bounds];
        state.overlay.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        state.overlay.wantsLayer = YES;
        state.overlay.layer.backgroundColor = NSColor.clearColor.CGColor;
        state.overlay.cursorState = state;
        [content addSubview:state.overlay positioned:NSWindowAbove relativeTo:nil];
        states[identifier] = state;
        installObservers();
        [state refresh];
        return inspectState(env, state);
    }
}

static napi_value setCursor(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        if (!mainThread(env)) return nullptr;
        size_t argc = 6;
        napi_value argv[6];
        napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
        if (argc < 2) {
            napi_throw_type_error(env, nullptr, "setCursor expects a window id and cursor type");
            return nullptr;
        }
        NSNumber *identifier = windowId(env, argv[0]);
        if (!identifier) return nullptr;
        BMCursorState *state = states[identifier];
        if (!state.attached) return jsUndefined(env);
        char buffer[64] = {};
        size_t typeLength = 0;
        if (napi_get_value_string_utf8(env, argv[1], buffer, sizeof(buffer), &typeLength) != napi_ok) {
            napi_throw_type_error(env, nullptr, "Cursor type must be a string");
            return nullptr;
        }
        NSString *type = [NSString stringWithUTF8String:buffer];
        NSCursor *cursor = nativeCursor(type);
        NSImage *image = cursor.image;
        NSPoint hotspot = cursor.hotSpot;
        BOOL supported = cursor != nil || [type isEqualToString:@"none"];
        if ([type isEqualToString:@"custom"] && argc >= 5) {
            void *png = nullptr;
            size_t pngLength = 0;
            double hotspotX = 0, hotspotY = 0, scale = 1;
            if (argc >= 6) napi_get_value_double(env, argv[5], &scale);
            if (napi_get_buffer_info(env, argv[2], &png, &pngLength) == napi_ok && pngLength > 0 && pngLength <= 4 * 1024 * 1024
                && napi_get_value_double(env, argv[3], &hotspotX) == napi_ok && napi_get_value_double(env, argv[4], &hotspotY) == napi_ok
                && std::isfinite(hotspotX) && std::isfinite(hotspotY) && std::isfinite(scale) && scale > 0 && scale <= 16) {
                image = [[NSImage alloc] initWithData:[NSData dataWithBytes:png length:pngLength]];
                NSSize size = image.size;
                if (size.width > 0 && size.height > 0 && size.width <= 2048 && size.height <= 2048) {
                    image.size = NSMakeSize(size.width / scale, size.height / scale);
                    hotspot = NSMakePoint(fmax(0, fmin(size.width, hotspotX)) / scale, fmax(0, fmin(size.height, hotspotY)) / scale);
                    supported = YES;
                } else {
                    image = nil;
                }
            }
        }
        NSRect oldRect = state.imageRect;
        state.cursorType = type;
        state.cursorImage = image;
        state.hotspot = hotspot;
        state.supported = supported;
        [state.overlay setNeedsDisplayInRect:NSInsetRect(oldRect, -2, -2)];
        [state refresh];
        return inspectState(env, state);
    }
}

static napi_value suspend(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        if (!mainThread(env)) return nullptr;
        size_t argc = 2;
        napi_value argv[2];
        napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
        bool suspended = false;
        if (argc < 2 || napi_get_value_bool(env, argv[1], &suspended) != napi_ok) {
            napi_throw_type_error(env, nullptr, "suspend expects a window id and boolean");
            return nullptr;
        }
        NSNumber *identifier = windowId(env, argv[0]);
        if (!identifier) return nullptr;
        BMCursorState *state = states[identifier];
        state.suspended = suspended;
        [state refresh];
        return inspectState(env, state);
    }
}

static napi_value detach(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        if (!mainThread(env)) return nullptr;
        size_t argc = 1;
        napi_value argv[1];
        napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
        if (!argc) {
            napi_throw_type_error(env, nullptr, "detach expects a window id");
            return nullptr;
        }
        NSNumber *identifier = windowId(env, argv[0]);
        if (!identifier) return nullptr;
        BMCursorState *state = states[identifier];
        [state detach];
        napi_value result = inspectState(env, state);
        [states removeObjectForKey:identifier];
        if (states.count == 0) uninstallObservers();
        return result;
    }
}

static napi_value inspect(napi_env env, napi_callback_info info) {
    @autoreleasepool {
        if (!mainThread(env)) return nullptr;
        size_t argc = 1;
        napi_value argv[1];
        napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
        if (!argc) {
            napi_throw_type_error(env, nullptr, "inspect expects a window id");
            return nullptr;
        }
        NSNumber *identifier = windowId(env, argv[0]);
        return identifier ? inspectState(env, states[identifier]) : nullptr;
    }
}

static void cleanup(void *unused) {
    for (BMCursorState *state in states.allValues) [state detach];
    [states removeAllObjects];
    uninstallObservers();
}

static napi_value initialize(napi_env env, napi_value exports) {
    if (!mainThread(env)) return nullptr;
    napi_property_descriptor properties[] = {
        { "attach", nullptr, attach, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "setCursor", nullptr, setCursor, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "suspend", nullptr, suspend, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "detach", nullptr, detach, nullptr, nullptr, nullptr, napi_default, nullptr },
        { "inspect", nullptr, inspect, nullptr, nullptr, nullptr, napi_default, nullptr },
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    napi_add_env_cleanup_hook(env, cleanup, nullptr);
    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
