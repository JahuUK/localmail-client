import { Mail, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WelcomePage({ onChooseLogin, onChooseRegister }: {
  onChooseLogin: () => void;
  onChooseRegister: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#f6f8fc" }}>
      <div className="w-full max-w-[400px] mx-4">
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: "#c2e7ff" }}>
              <Mail className="w-7 h-7 text-[#001d35]" />
            </div>
            <h1 className="text-2xl font-medium text-[#202124]" data-testid="text-welcome-title">LocalMail</h1>
            <p className="text-sm text-[#5f6368] mt-1 text-center">Your self-hosted email client</p>
          </div>

          <div className="space-y-3">
            <Button
              onClick={onChooseLogin}
              className="w-full rounded-full h-11"
              style={{ backgroundColor: "#0b57d0" }}
              data-testid="button-welcome-login"
            >
              <LogIn className="h-4 w-4 mr-2" />
              Sign in to your account
            </Button>

            <Button
              onClick={onChooseRegister}
              variant="outline"
              className="w-full rounded-full h-11 border-[#dadce0] text-[#202124] hover:bg-[#f6f8fc]"
              data-testid="button-welcome-register"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Create a new account
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
