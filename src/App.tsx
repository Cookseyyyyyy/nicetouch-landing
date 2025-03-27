import { useState, useEffect } from "react";
import "./App.css";
import BallPit from "./components/ballpit";

function App() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Add a useEffect to log when the App component mounts
  useEffect(() => {
    console.log("App component mounted");
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Here you would typically send the email to your backend or service
    console.log("Email submitted:", email);
    setSubmitted(true);
    setEmail("");
  };

  return (
    <div className="landing-container">
      {/* 3D grid of spheres with multiple materials */}
      <BallPit gridWidth={10} gridHeight={10} gridDepth={2} />

      <header className="header">
        <div className="brand">Nice Touch</div>
        <nav>
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
        </nav>
      </header>

      <main className="main-content">
        <div className="hero-content">
          <h1 className="main-title">
            YOUR TOOLS
            <br />
            YOUR VISION
            <br />
            NICE TOUCH
          </h1>
          <p className="infoline">
            See What A Nice Touch Can Do. Join The List.
          </p>

          <div className="signup-box">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="signup-form">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter Your Email Address"
                  required
                />
                <button type="submit">SIGN UP</button>
              </form>
            ) : (
              <div className="success-message">
                <p>Thank you for signing up!</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;