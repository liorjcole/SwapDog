//
//  AppConstants.swift
//  SwapDog
//
//  App-wide constants. Use these instead of magic strings or numbers anywhere
//  in the codebase. Never instantiate this enum — it is a pure namespace.
//
//  Updated (Step 10): Added search radius constants, UserDefaults keys,
//  delete confirmation word, and placeholder legal URLs.
//

import Foundation
import CoreLocation

/// Top-level namespace for all SwapDog app constants.
enum AppConstants {

    // MARK: - App Identity

    /// Human-readable app name displayed in UI strings.
    static let appName = "SwapDog"

    /// Bundle identifier — must match the Xcode project setting.
    static let bundleID = "com.swapdog.app"

    /// App Store product page URL (populated before App Store submission).
    static let appStoreURL = "https://apps.apple.com/app/swapdog"

    // MARK: - Discovery / Search Radius

    /// Default search radius in kilometres when the user has not set a preference.
    static let defaultSearchRadiusKm: Double = 10

    /// Maximum allowed search radius in kilometres.
    static let maxSearchRadiusKm: Double = 50

    /// Default search radius in miles for the Settings slider.
    static let defaultSearchRadiusMiles: Double = 10.0

    /// Minimum search radius in miles (Settings slider lower bound).
    static let minSearchRadiusMiles: Double = 1.0

    /// Maximum search radius in miles (Settings slider upper bound).
    static let maxSearchRadiusMiles: Double = 50.0

    /// Minimum distance (metres) the device must move before triggering a location refresh.
    static let locationUpdateDistanceMetres: CLLocationDistance = 500

    // MARK: - Firestore Collections

    /// Firestore collection path constants — never hard-code these in feature code.
    enum Firestore {
        static let users         = "users"
        static let dogs          = "dogs"
        static let swapRequests  = "swapRequests"
        static let messages      = "messages"
        static let conversations = "conversations"
        static let reviews       = "reviews"
    }

    // MARK: - Storage Paths

    /// Firebase Storage path prefixes.
    enum Storage {
        static let profileImages = "profile_images"
        static let dogImages     = "dog_images"
    }

    // MARK: - Pagination

    /// Default number of items fetched per Firestore query page.
    static let defaultPageSize = 20

    // MARK: - Validation

    /// Minimum number of characters required for a display name.
    static let minDisplayNameLength = 2

    /// Maximum number of characters allowed in a user bio.
    static let maxBioLength = 300

    /// Maximum number of dogs a single user may register.
    static let maxDogsPerUser = 5

    /// Maximum size (bytes) allowed for an image upload — 5 MB.
    static let maxImageUploadBytes: Int = 5 * 1024 * 1024

    // MARK: - Timing

    /// Debounce delay (seconds) for search input fields.
    static let searchDebounceSeconds: Double = 0.4

    /// Standard animation duration for push/pop transitions.
    static let defaultAnimationDuration: Double = 0.3

    // MARK: - Notifications

    /// User-facing notification category identifiers.
    enum NotificationCategory {
        static let swapRequest  = "SWAP_REQUEST"
        static let newMessage   = "NEW_MESSAGE"
        static let swapReminder = "SWAP_REMINDER"
    }

    // MARK: - Account Management

    /// The exact string the user must type to confirm account deletion.
    static let deleteAccountConfirmationWord = "DELETE"

    // MARK: - Legal URLs (placeholder — replace before App Store submission)

    /// Terms of Service web page URL.
    static let termsOfServiceURL = "https://swapdog.app/terms"

    /// Privacy Policy web page URL.
    static let privacyPolicyURL = "https://swapdog.app/privacy"

    // MARK: - Support

    /// Display name for the WatchDog Team system sender in conversations.
    static let watchdogTeamDisplayName = "WatchDog Team"

    /// Primary support email address shown in the messaging footer.
    static let supportEmail = "hi@joinwatchdog.com"

    // MARK: - UserDefaults Keys

    /// Strongly-typed UserDefaults key strings for local preferences.
    ///
    /// Use with `@AppStorage` in SwiftUI views or `UserDefaults.standard`
    /// in non-view code. All keys are prefixed with the bundle ID to avoid
    /// collisions with system keys.
    enum UserDefaultsKeys {
        /// Whether to receive push notifications for incoming swap requests.
        static let notifySwapRequests = "com.swapdog.app.notify.swapRequests"
        /// Whether to receive push notifications for new messages.
        static let notifyMessages     = "com.swapdog.app.notify.messages"
        /// Whether to receive reminder push notifications.
        static let notifyReminders    = "com.swapdog.app.notify.reminders"
        /// User's preferred discovery search radius in miles.
        static let searchRadiusMiles  = "com.swapdog.app.discovery.searchRadiusMiles"
    }
}
