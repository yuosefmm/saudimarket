
import argparse
import time
import sys
from backend.manager import update_all_prices, sync_history_for_symbol, sync_all_history

def main():
    parser = argparse.ArgumentParser(description="Saudi Stock Market Backend Manager")
    subparsers = parser.add_subparsers(dest='command', help='Command to run')

    # Command: update-prices
    parser_update = subparsers.add_parser('update-prices', help='Update real-time prices for all stocks')
    parser_update.add_argument('--loop', action='store_true', help='Run in a loop every 15 minutes')

    # Command: sync-history
    parser_history = subparsers.add_parser('sync-history', help='Backfill historical data')
    parser_history.add_argument('--symbol', type=str, help='Specific symbol to sync (e.g., 1120). If omitted, syncs ALL.')
    parser_history.add_argument('--period', type=str, default='1mo', help='Period to fetch (1mo, 1y, 5y, max). Default 1mo.')
    parser_history.add_argument('--clear', action='store_true', help='Clear existing history before syncing')

    args = parser.parse_args()

    if args.command == 'update-prices':
        if args.loop:
            print("🔄 Starting Price Updater Service (Loop Mode)...")
            try:
                while True:
                    update_all_prices()
                    print("sleeping 15 mins...")
                    time.sleep(900)
            except KeyboardInterrupt:
                print("\nStopping service...")
        else:
            update_all_prices()

    elif args.command == 'sync-history':
        if args.symbol:
            sync_history_for_symbol(args.symbol, period=args.period, should_clear=args.clear)
        else:
            # Confirm for ALL
            if args.period not in ['1mo', '1d', '5d']: # Safety check for long periods
                print(f"⚠️  Warning: You are about to sync ALL stocks with period '{args.period}'. This may take time.")
                # confirm = input("Continue? (y/n): ")
                # if confirm.lower() != 'y':
                #    return
            sync_all_history(period=args.period, should_clear=args.clear)

    else:
        parser.print_help()

if __name__ == '__main__':
    main()
