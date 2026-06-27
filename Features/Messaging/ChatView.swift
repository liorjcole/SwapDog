//
//  ChatView.swift
//  SwapDog
//
//  Full-screen chat UI for a single conversation.
//  Bubbles are ordered oldest → newest (top → bottom).
//  Auto-scrolls to the newest message on appear and when count changes.
//  Keyboard-aware via .safeAreaInset(edge: .bottom).
//
//  Architecture layer: Features/Messaging (View)
//  Locked decisions:
//    - Messages ordered oldest top, newest bottom
//    - Auto-scroll to bottom on appear and new message
//    - Keyboard never obscures input bar (.safeAreaInset)
//    - Pagination pull-up for older messages (near top detection)
//

import SwiftUI

// MARK: - ChatView

/// Renders a conversation's message history and a bottom input bar.
///
/// The scroll view auto-scrolls to the newest message on first appear and
/// whenever the message count increases. The input bar floats above the
/// keyboard via `.safeAreaInset(edge: .bottom)`.
struct ChatView: View {

    // MARK: - Dependencies

    @StateObject var viewModel: ChatViewModel
    let currentUserID: String

    // MARK: - Private Constants

    private enum ScrollAnchor {
        static let bottomID = "chat_bottom_anchor"
    }

    // MARK: - Body

    var body: some View {
        messageScrollView
            .navigationTitle(viewModel.otherUserName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { navBarContent }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ChatInputBar(
                    text:      $viewModel.messageText,
                    isSending: viewModel.isSending
                ) {
                    await viewModel.sendMessage()
                }
            }
            .screenBackground()
            .dynamicTypeSize(...DynamicTypeSize.accessibility3)
            .task {
                viewModel.startListening()
                await viewModel.markAsRead()
            }
            .alert("Send Failed", isPresented: sendErrorBinding) {
                Button("Retry") {
                    Task { await viewModel.sendMessage() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(viewModel.sendErrorMessage ?? "")
            }
    }

    // MARK: - Navigation Bar

    @ToolbarContentBuilder
    private var navBarContent: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            HStack(spacing: Theme.Spacing.sm) {
                chatHeaderAvatar
                    .accessibilityHidden(true)

                Text(viewModel.otherUserName)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                    .accessibilityAddTraits(.isHeader)
            }
        }
    }

    /// Avatar shown in the chat navigation bar.
    ///
    /// WatchDog Team conversations display the dog emoji instead of a remote image.
    @ViewBuilder
    private var chatHeaderAvatar: some View {
        if viewModel.otherUserName == AppConstants.watchdogTeamDisplayName {
            Text("🐶")
                .font(.system(size: 20))
                .frame(width: 32, height: 32)
                .background(Theme.Colors.shimmerBase)
                .clipShape(Circle())
        } else {
            CachedAsyncImage(urlString: viewModel.otherUserImageURL ?? "")
                .frame(width: 32, height: 32)
                .clipShape(Circle())
        }
    }

    // MARK: - Scroll View

    private var messageScrollView: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Theme.Spacing.sm) {
                    // Pull-to-load-older trigger (appears above the message list).
                    paginationTrigger(proxy: proxy)

                    // Message rows with timestamp separators.
                    ForEach(Array(viewModel.messages.enumerated()), id: \.element.id) { index, message in
                        let previousMessage = index > 0 ? viewModel.messages[index - 1] : nil
                        let showSeparator = shouldShowSeparator(message: message, previous: previousMessage)

                        VStack(spacing: Theme.Spacing.xs) {
                            if showSeparator {
                                TimestampSeparator(date: message.timestamp)
                            }

                            MessageRow(
                                message:           message,
                                isFromCurrentUser: message.senderID == currentUserID,
                                showTimestamp:     showTimestamp(message: message, index: index)
                            )
                        }
                    }

                    // Invisible anchor for programmatic scroll-to-bottom.
                    Color.clear
                        .frame(height: 1)
                        .id(ScrollAnchor.bottomID)
                }
                .padding(.vertical, Theme.Spacing.md)
            }
            // Auto-scroll to bottom on first appear.
            .onAppear {
                scrollToBottom(proxy: proxy, animated: false)
            }
            // Auto-scroll to bottom when a new message arrives.
            .onChange(of: viewModel.messages.count) {
                scrollToBottom(proxy: proxy, animated: true)
            }
        }
    }

    // MARK: - Pagination Trigger

    @ViewBuilder
    private func paginationTrigger(proxy: ScrollViewProxy) -> some View {
        if viewModel.isLoadingOlder {
            ProgressView()
                .tint(Theme.Colors.primary)
                .padding(.vertical, Theme.Spacing.sm)
        } else if !viewModel.messages.isEmpty {
            // When the user scrolls near the top, trigger a page load.
            GeometryReader { geo in
                Color.clear
                    .onAppear {
                        Task { await viewModel.loadOlderMessages() }
                    }
            }
            .frame(height: 1)
        }
    }

    // MARK: - Timestamp Logic

    /// Whether a 15-minute cluster separator should appear before this message.
    private func shouldShowSeparator(message: Message, previous: Message?) -> Bool {
        guard let previous else {
            // Always show a separator before the very first message.
            return true
        }
        return message.timestamp.shouldShowTimestamp(
            comparedTo: previous.timestamp,
            intervalMinutes: 15
        )
    }

    /// Whether to show the time label below a bubble.
    ///
    /// Shows for the last message in a cluster (i.e., the next message starts a new separator).
    private func showTimestamp(message: Message, index: Int) -> Bool {
        let nextIndex = index + 1
        guard nextIndex < viewModel.messages.count else {
            return true // Always show below the very last message.
        }
        let next = viewModel.messages[nextIndex]
        return next.timestamp.shouldShowTimestamp(
            comparedTo: message.timestamp,
            intervalMinutes: 15
        )
    }

    // MARK: - Scroll Helpers

    private func scrollToBottom(proxy: ScrollViewProxy, animated: Bool) {
        if animated {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(ScrollAnchor.bottomID, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(ScrollAnchor.bottomID, anchor: .bottom)
        }
    }

    // MARK: - Bindings

    private var sendErrorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.sendErrorMessage != nil },
            set: { _ in }
        )
    }
}

// MARK: - Preview

#Preview("Chat — With Messages") {
    let mockRepo: MockMessagingRepository = {
        let r = MockMessagingRepository()
        // Seed several messages to exercise clusters and separators.
        r.messages = [
            Message(
                id: "m1",
                conversationID: "conv_mock_001",
                senderID: "usr_mock_002",
                text: "Hey! Are you free this weekend?",
                timestamp: Date().addingTimeInterval(-3700),
                readBy: ["usr_mock_002"]
            ),
            Message(
                id: "m2",
                conversationID: "conv_mock_001",
                senderID: "usr_mock_001",
                text: "Yes! Saturday works great for Luna.",
                timestamp: Date().addingTimeInterval(-3600),
                readBy: ["usr_mock_001"]
            ),
            Message(
                id: "m3",
                conversationID: "conv_mock_001",
                senderID: "usr_mock_002",
                text: "Perfect! Let's meet at the park around 10 AM.",
                timestamp: Date().addingTimeInterval(-900),
                readBy: ["usr_mock_002"]
            ),
            Message(
                id: "m4",
                conversationID: "conv_mock_001",
                senderID: "usr_mock_001",
                text: "Sounds great, see you then! 🐶",
                timestamp: Date().addingTimeInterval(-120),
                readBy: ["usr_mock_001"]
            ),
        ]
        return r
    }()
    let vm = ChatViewModel(
        conversationID:      "conv_mock_001",
        currentUserID:       "usr_mock_001",
        otherUser:           .mock,
        messagingRepository: mockRepo
    )
    return NavigationStack {
        ChatView(viewModel: vm, currentUserID: "usr_mock_001")
    }
}
