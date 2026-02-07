import React from 'react';
import { View, FlatList, Platform, Pressable } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Text } from '@/components/StyledText';
import { useAllSessions } from '@/sync/storage';
import { Session } from '@/sync/storageTypes';
import { Avatar } from '@/components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import { getSessionName, getSessionSubtitle, getSessionAvatarId } from '@/utils/sessionUtils';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { layout } from '@/components/layout';
import { useNavigateToSession } from '@/hooks/useNavigateToSession';
import { sessionDelete } from '@/sync/ops';
import { useHappyAction } from '@/hooks/useHappyAction';
import { HappyError } from '@/utils/errors';
import { Modal } from '@/modal';
import { t } from '@/text';

interface SessionHistoryItem {
    type: 'session' | 'date-header';
    session?: Session;
    date?: string;
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'stretch',
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        flex: 1,
        maxWidth: layout.maxWidth,
    },
    dateHeader: {
        backgroundColor: theme.colors.groupped.background,
        paddingTop: 20,
        paddingBottom: 8,
        paddingHorizontal: 24,
    },
    dateHeaderText: {
        ...Typography.default('semiBold'),
        color: theme.colors.groupped.sectionTitle,
        fontSize: 14,
        fontWeight: '600',
        letterSpacing: 0.1,
    },
    sessionCard: {
        backgroundColor: theme.colors.surface,
        paddingVertical: 16,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
    },
    sessionCardFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionCardLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
    },
    sessionCardSingle: {
        borderRadius: 12,
    },
    sessionContent: {
        flex: 1,
        marginLeft: 16,
    },
    sessionTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: theme.colors.text,
        marginBottom: 2,
        ...Typography.default('semiBold'),
    },
    sessionSubtitle: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default(),
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyText: {
        fontSize: 16,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        ...Typography.default(),
    },
    sessionCardContainer: {
        marginHorizontal: 16,
        marginBottom: 1,
        overflow: 'hidden',
    },
    sessionCardContainerFirst: {
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
    },
    sessionCardContainerLast: {
        borderBottomLeftRadius: 12,
        borderBottomRightRadius: 12,
        marginBottom: 12,
    },
    sessionCardContainerSingle: {
        borderRadius: 12,
        marginBottom: 12,
    },
    swipeAction: {
        width: 112,
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.status.error,
    },
    swipeActionText: {
        marginTop: 4,
        fontSize: 12,
        color: '#FFFFFF',
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
}));

function formatDateHeader(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (sessionDate.getTime() === today.getTime()) {
        return t('sessionHistory.today');
    } else if (sessionDate.getTime() === yesterday.getTime()) {
        return t('sessionHistory.yesterday');
    } else {
        const diffTime = today.getTime() - sessionDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        return t('sessionHistory.daysAgo', { count: diffDays });
    }
}

function groupSessionsByDate(sessions: Session[]): SessionHistoryItem[] {
    const sortedSessions = sessions
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt);
    
    const items: SessionHistoryItem[] = [];
    let currentDateGroup: Session[] = [];
    let currentDateString: string | null = null;
    
    for (const session of sortedSessions) {
        const sessionDate = new Date(session.updatedAt);
        const dateString = sessionDate.toDateString();
        
        if (currentDateString !== dateString) {
            // Process previous group
            if (currentDateGroup.length > 0) {
                items.push({
                    type: 'date-header',
                    date: formatDateHeader(new Date(currentDateString!)),
                });
                currentDateGroup.forEach(sess => {
                    items.push({ type: 'session', session: sess });
                });
            }
            
            // Start new group
            currentDateString = dateString;
            currentDateGroup = [session];
        } else {
            currentDateGroup.push(session);
        }
    }
    
    // Process final group
    if (currentDateGroup.length > 0) {
        items.push({
            type: 'date-header',
            date: formatDateHeader(new Date(currentDateString!)),
        });
        currentDateGroup.forEach(sess => {
            items.push({ type: 'session', session: sess });
        });
    }
    
    return items;
}

const SessionHistoryRow = React.memo(({ session, isFirst, isLast, isSingle }: {
    session: Session;
    isFirst: boolean;
    isLast: boolean;
    isSingle: boolean;
}) => {
    const navigateToSession = useNavigateToSession();
    const swipeableRef = React.useRef<Swipeable | null>(null);
    const swipeEnabled = Platform.OS !== 'web';

    const sessionName = getSessionName(session);
    const sessionSubtitle = getSessionSubtitle(session);
    const avatarId = getSessionAvatarId(session);

    const [deletingSession, performDelete] = useHappyAction(async () => {
        const result = await sessionDelete(session.id);
        if (!result.success) {
            throw new HappyError(result.message || t('sessionInfo.failedToDeleteSession'), false);
        }
    });

    const handleDelete = React.useCallback(() => {
        swipeableRef.current?.close();
        Modal.alert(
            t('sessionInfo.deleteSession'),
            t('sessionInfo.deleteSessionWarning'),
            [
                { text: t('common.cancel'), style: 'cancel' },
                {
                    text: t('sessionInfo.deleteSession'),
                    style: 'destructive',
                    onPress: performDelete
                }
            ]
        );
    }, [performDelete]);

    const itemContent = (
        <Pressable
            style={[
                styles.sessionCard,
                isSingle ? styles.sessionCardSingle :
                isFirst ? styles.sessionCardFirst :
                isLast ? styles.sessionCardLast : {}
            ]}
            onPress={() => navigateToSession(session.id)}
            onLongPress={!swipeEnabled ? handleDelete : undefined}
        >
            <Avatar id={avatarId} size={48} />
            <View style={styles.sessionContent}>
                <Text style={styles.sessionTitle} numberOfLines={1}>
                    {sessionName}
                </Text>
                <Text style={styles.sessionSubtitle} numberOfLines={1}>
                    {sessionSubtitle}
                </Text>
            </View>
        </Pressable>
    );

    const containerStyles = [
        styles.sessionCardContainer,
        isSingle ? styles.sessionCardContainerSingle :
            isFirst ? styles.sessionCardContainerFirst :
                isLast ? styles.sessionCardContainerLast : {}
    ];

    if (!swipeEnabled) {
        return (
            <View style={containerStyles}>
                {itemContent}
            </View>
        );
    }

    const renderRightActions = () => (
        <Pressable
            style={styles.swipeAction}
            onPress={handleDelete}
            disabled={deletingSession}
        >
            <Ionicons name="trash-outline" size={20} color="#FFFFFF" />
            <Text style={styles.swipeActionText} numberOfLines={2}>
                {t('sessionInfo.deleteSession')}
            </Text>
        </Pressable>
    );

    return (
        <View style={containerStyles}>
            <Swipeable
                ref={swipeableRef}
                renderRightActions={renderRightActions}
                overshootRight={false}
                enabled={!deletingSession}
            >
                {itemContent}
            </Swipeable>
        </View>
    );
});

export default function SessionHistory() {
    const safeArea = useSafeAreaInsets();
    const allSessions = useAllSessions();
    
    const groupedItems = React.useMemo(() => {
        return groupSessionsByDate(allSessions);
    }, [allSessions]);
    
    const renderItem = React.useCallback(({ item, index }: { item: SessionHistoryItem, index: number }) => {
        if (item.type === 'date-header') {
            return (
                <View style={styles.dateHeader}>
                    <Text style={styles.dateHeaderText}>
                        {item.date}
                    </Text>
                </View>
            );
        }
        
        if (item.type === 'session' && item.session) {
            const session = item.session;
            
            // Determine card styling based on position within date group
            const prevItem = index > 0 ? groupedItems[index - 1] : null;
            const nextItem = index < groupedItems.length - 1 ? groupedItems[index + 1] : null;
            
            const isFirst = prevItem?.type === 'date-header';
            const isLast = nextItem?.type === 'date-header' || nextItem == null;
            const isSingle = isFirst && isLast;
            
            return (
                <SessionHistoryRow
                    session={session}
                    isFirst={isFirst}
                    isLast={isLast}
                    isSingle={isSingle}
                />
            );
        }
        
        return null;
    }, [groupedItems]);
    
    const keyExtractor = React.useCallback((item: SessionHistoryItem, index: number) => {
        if (item.type === 'date-header') {
            return `date-${item.date}-${index}`;
        }
        if (item.type === 'session' && item.session) {
            return `session-${item.session.id}`;
        }
        return `item-${index}`;
    }, []);
    
    if (!allSessions) {
        return (
            <View style={styles.container}>
                <View style={styles.contentContainer} />
            </View>
        );
    }
    
    if (groupedItems.length === 0) {
        return (
            <View style={styles.container}>
                <View style={styles.contentContainer}>
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyText}>
                            {t('sessionHistory.empty')}
                        </Text>
                    </View>
                </View>
            </View>
        );
    }
    
    return (
        <View style={styles.container}>
            <View style={styles.contentContainer}>
                <FlatList
                    data={groupedItems}
                    renderItem={renderItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={{ 
                        paddingBottom: safeArea.bottom + 16,
                        paddingTop: 8,
                    }}
                />
            </View>
        </View>
    );
}