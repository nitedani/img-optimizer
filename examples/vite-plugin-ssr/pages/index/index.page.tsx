import React from "react";
import image from "./test-8k.jpg";
import { Image } from "@nitedani/img-optimizer-react";

export function Page() {
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
