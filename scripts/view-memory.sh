#!/bin/bash
# View Nova's Memory Database

echo "🧠 Nova Memory Viewer"
echo "===================="
echo ""

DB_PATH="$HOME/.nova/memory.db"

if [ ! -f "$DB_PATH" ]; then
    echo "❌ Memory database not found at $DB_PATH"
    exit 1
fi

case "$1" in
    "stats")
        echo "📊 Memory Statistics:"
        echo ""
        sqlite3 "$DB_PATH" "SELECT category, COUNT(*) as count FROM memories GROUP BY category;"
        echo ""
        sqlite3 "$DB_PATH" "SELECT COUNT(*) as total FROM memories;"
        ;;
    "conversations"|"chat")
        echo "💬 Recent Conversations:"
        echo ""
        sqlite3 "$DB_PATH" "SELECT datetime(timestamp/1000, 'unixepoch') as time, content FROM memories WHERE category='conversation' ORDER BY timestamp DESC LIMIT ${2:-10};" -header
        ;;
    "tools")
        echo "🔧 Recent Tool Usage:"
        echo ""
        sqlite3 "$DB_PATH" "SELECT datetime(timestamp/1000, 'unixepoch') as time, content, tags FROM memories WHERE category='self' AND tags LIKE '%tool-usage%' ORDER BY timestamp DESC LIMIT ${2:-10};" -header
        ;;
    "user")
        echo "👤 User Profile:"
        echo ""
        sqlite3 "$DB_PATH" "SELECT key, value FROM user_profile;"
        echo ""
        echo "Recent user-related memories:"
        sqlite3 "$DB_PATH" "SELECT content FROM memories WHERE category='user' ORDER BY timestamp DESC LIMIT 5;"
        ;;
    "agent")
        echo "🤖 Agent Profile:"
        echo ""
        sqlite3 "$DB_PATH" "SELECT key, value FROM agent_profile;"
        ;;
    "search")
        if [ -z "$2" ]; then
            echo "Usage: $0 search <query>"
            exit 1
        fi
        echo "🔍 Searching for: $2"
        echo ""
        sqlite3 "$DB_PATH" "SELECT datetime(timestamp/1000, 'unixepoch') as time, category, content FROM memories WHERE content LIKE '%$2%' ORDER BY timestamp DESC LIMIT 20;" -header
        ;;
    "clear")
        read -p "⚠️  Are you sure you want to clear ALL memories? (yes/no): " confirm
        if [ "$confirm" = "yes" ]; then
            sqlite3 "$DB_PATH" "DELETE FROM memories;"
            echo "✅ All memories cleared"
        else
            echo "❌ Cancelled"
        fi
        ;;
    *)
        echo "Usage: $0 {stats|chat|tools|user|agent|search|clear} [args]"
        echo ""
        echo "Commands:"
        echo "  stats              - Show memory statistics"
        echo "  chat [N]          - Show last N conversations (default: 10)"
        echo "  tools [N]         - Show last N tool usages (default: 10)"
        echo "  user              - Show user profile and memories"
        echo "  agent             - Show agent profile"
        echo "  search <query>    - Search memories for query"
        echo "  clear             - Clear all memories (with confirmation)"
        exit 1
        ;;
esac
