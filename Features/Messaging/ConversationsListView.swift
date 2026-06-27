//
//  ConversationsListView.swift
//  SwapDog
//
//  Root messaging screen — shows a list of conversations sorted newest-first.
//  Each row displays the other person's avatar, name, last message preview,
//  relative timestamp, and an unread indicator dot.
//
//  Architecture layer: Features/Messaging (View)
//  Locked decisions:
//    - Tapping a row navigates to ChatView
//    - Empty state: dog icon + copy encouraging the user to find a swapper
//

import SwiftUI

// MARK: - ConversationsListView

/// Displays all conversations for the current user in a `List`, sorted newest first.
///
/// Subscribes to the real-time stream via `ConversationsViewModel.startListening()`
/// and presents a shimmer skeleton while the first batch loads.
struct ConversationsListView: View {

    // MARK: - Dependencies

    @ObservedObject var viewModel: ConversationsViewModel

    /// The signed-in user's UID — forwarded to ChatView for bubble alignment.
    let currentUserID: String

    /// Repositories forwarded to ChatViewModel when a conversation is tapped.
    let messagingRepository: any MessagingRepositoryProtocol

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading && viewModel.conversations.isEmpty {
                    shimmerList
                } else if viewModel.conversations.isEmpty {
                    emptyState
                } else {
                    conversationList
                }
            }
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(.large)
            .screenBackground()
        }
        .task {
            viewModel.startListening()
        }
        .alert("Error", isPresented: errorBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    // MARK: - Conversation List

    private var conversationList: some View {
        List {
            ForEach(viewModel.conversations) { item in
                NavigationLink(destination: chatDestination(for: item)) {
                    ConversationRow(item: item, currentUserID: currentUserID)
                }
                .listRowBackground(Theme.Colors.surface)
                .listRowSeparatorTint(Theme.Colors.textSecondary.opacity(0.15))
                .listRowInsets(EdgeInsets(
                    top: Theme.Spacing.sm,
                    leading: Theme.Spacing.md,
                    bottom: Theme.Spacing.sm,
                    trailing: Theme.Spacing.md
                ))
            }

            supportFooter
        }
        .listStyle(.plain)
        .background(Theme.Colors.background)
    }

    // MARK: - Navigation Destination

    @ViewBuilder
    private func chatDestination(for item: ConversationItem) -> some View {
        let chatVM = ChatViewModel(
            conversationID:      item.conversation.id,
            currentUserID:       currentUserID,
            otherUser:           item.otherUser,
            messagingRepository: messagingRepository
        )
        ChatView(viewModel: chatVM, currentUserID: currentUserID)
    }

    // MARK: - Shimmer Skeleton

    private var shimmerList: some View {
        List {
            ForEach(0..<5, id: \.self) { _ in
                ConversationRowSkeleton()
                    .listRowBackground(Theme.Colors.surface)
                    .listRowSeparatorTint(Color.clear)
                    .listRowInsets(EdgeInsets(
                        top: Theme.Spacing.sm,
                        leading: Theme.Spacing.md,
                        bottom: Theme.Spacing.sm,
                        trailing: Theme.Spacing.md
                    ))
            }
        }
        .listStyle(.plain)
        .allowsHitTesting(false)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        EmptyStateView(
            icon: "bubble.left.and.bubble.right",
            title: "No messages yet",
            subtitle: "Find a nearby swapper and start a conversation!"
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Support Footer

    /// Informational footer row appended below the conversation list.
    ///
    /// Scrolls with the content. Font explicitly set to 16 pt
    /// (footnote base 13 pt + 3 per design spec).
    private var supportFooter: some View {
        Text("For support, email \(AppConstants.supportEmail)")
            .font(.system(size: 16))
            .foregroundStyle(Theme.Colors.textSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Theme.Spacing.md)
            .listRowBackground(Color.clear)
            .listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
    }

    // MARK: - Helpers

    private var errorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { /* dismiss — error clears on next successful load */ } }
        )
    }
}

// MARK: - ConversationRow

/// A single row in the conversations list.
private struct ConversationRow: View {

    let item: ConversationItem
    let currentUserID: String

    private var unread: Int { item.unreadCount(for: currentUserID) }
    private var hasUnread: Bool { unread > 0 }

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            avatarView
            contentStack
            Spacer(minLength: 0)
            trailingStack
        }
        .padding(.vertical, Theme.Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    // MARK: Subviews

    private var avatarView: some View {
        Group {
            if item.otherUser?.displayName == AppConstants.watchdogTeamDisplayName {
                // WatchDog Team: dog emoji centered in the avatar circle
                Text("🐶")
                    .font(.system(size: 30))
                    .frame(width: 52, height: 52)
                    .background(Theme.Colors.shimmerBase)
                    .clipShape(Circle())
            } else {
                CachedAsyncImage(urlString: item.otherUser?.profileImageURL ?? "")
                    .frame(width: 52, height: 52)
                    .clipShape(Circle())
            }
        }
        .overlay(Circle().stroke(Theme.Colors.surface, lineWidth: 1.5))
        .accessibilityHidden(true)
    }

    private var contentStack: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            Text(item.otherUser?.displayName ?? "Loading…")
                .font(hasUnread ? Theme.Typography.headline : Theme.Typography.body)
                .foregroundStyle(Theme.Colors.textPrimary)
                .lineLimit(1)

            Text(item.lastMessagePreview)
                .font(Theme.Typography.subheadline)
                .foregroundStyle(
                    hasUnread
                        ? Theme.Colors.textPrimary
                        : Theme.Colors.textSecondary
                )
                .lineLimit(1)
        }
    }

    private var trailingStack: some View {
        VStack(alignment: .trailing, spacing: Theme.Spacing.xs) {
            Text(item.relativeTimestamp)
                .font(Theme.Typography.caption)
                .foregroundStyle(
                    hasUnread
                        ? Theme.Colors.primary
                        : Theme.Colors.textSecondary
                )

            if hasUnread {
                unreadBadge
            }
        }
    }

    private var unreadBadge: some View {
        Circle()
            .fill(Theme.Colors.primary)
            .frame(width: 10, height: 10)
            .accessibilityLabel("\(unread) unread message\(unread == 1 ? "" : "s")")
    }
}

// MARK: - ConversationRowSkeleton

/// Shimmer placeholder rendered while conversations load.
private struct ConversationRowSkeleton: View {

    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            Circle()
                .fill(Theme.Colors.shimmerBase)
                .frame(width: 52, height: 52)
                .shimmer(active: true)

            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Theme.Colors.shimmerBase)
                    .frame(height: 14)
                    .frame(maxWidth: 140)
                    .shimmer(active: true)

                RoundedRectangle(cornerRadius: 4)
                    .fill(Theme.Colors.shimmerBase)
                    .frame(height: 12)
                    .frame(maxWidth: 220)
                    .shimmer(active: true)
            }
            Spacer()
        }
        .padding(.vertical, Theme.Spacing.xs)
    }
}

// MARK: - Preview

#Preview("Conversations List") {
    let mockMessaging: MockMessagingRepository = {
        let r = MockMessagingRepository()
        // Add a second mock conversation so the list is interesting.
        r.conversations = [
            Conversation(
                id: "conv_mock_001",
                participantIDs: ["usr_mock_001", "usr_mock_002"],
                lastMessage: "Hi! Luna loves your neighbourhood.",
                lastMessageTimestamp: Date().addingTimeInterval(-120),
                unreadCount: ["usr_mock_001": 0, "usr_mock_002": 2]
            ),
            Conversation(
                id: "conv_mock_002",
                participantIDs: ["usr_mock_001", "usr_mock_003"],
                lastMessage: "Let me know which weekend works for you!",
                lastMessageTimestamp: Date().addingTimeInterval(-3600),
                unreadCount: ["usr_mock_001": 1, "usr_mock_003": 0]
            ),
        ]
        return r
    }()
    let mockUsers: MockUserRepository = {
        let r = MockUserRepository()
        r.users = [.mock]
        return r
    }()
    let vm = ConversationsViewModel(
        messagingRepository: mockMessaging,
        userRepository:      mockUsers,
        currentUserID:       "usr_mock_002"
    )
    return ConversationsListView(
        viewModel:           vm,
        currentUserID:       "usr_mock_002",
        messagingRepository: mockMessaging
    )
}

#Preview("Empty State") {
    let vm = ConversationsViewModel(
        messagingRepository: MockMessagingRepository(),
        userRepository:      MockUserRepository(),
        currentUserID:       "usr_new"
    )
    ConversationsListView(
        viewModel:           vm,
        currentUserID:       "usr_new",
        messagingRepository: MockMessagingRepository()
    )
}
