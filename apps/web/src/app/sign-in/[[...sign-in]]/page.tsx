import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
            {/* Background effects */}
            <div className="absolute inset-0 -z-10">
                <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-purple-600/15 rounded-full blur-[100px]" />
                <div className="absolute bottom-1/3 right-1/4 w-72 h-72 bg-pink-600/15 rounded-full blur-[100px]" />
            </div>

            <SignIn
                appearance={{
                    elements: {
                        rootBox: 'mx-auto',
                        card: 'bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl',
                    },
                }}
            />
        </div>
    );
}
