import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// 演示版不启用 StrictMode：模拟流式回答的定时器会被重复触发。
createRoot(document.getElementById("root")!).render(<App />);
