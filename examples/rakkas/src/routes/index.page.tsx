import image from "./test-8k.jpg";
import { Image } from "img-optimizer-react";

export default function Page() {
  return (
    <>
      <div
        style={{
          position: "relative",
          height: "500px",
        }}
      >
        <Image
          src={image}
          fill
          alt=""
          style={{
            objectFit: "contain",
            background: "#cef",
          }}
        />
      </div>
      <Image
        src={image}
        width="600"
        height="600"
        alt=""
        style={{
          objectFit: "contain",
          background: "#fcc",
        }}
      />
    </>
  );
}