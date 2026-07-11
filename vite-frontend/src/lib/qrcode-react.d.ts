import React from "react";

interface QRCodeSVGProps extends React.SVGProps<SVGSVGElement> {
  value: string;
  size?: number;
  level?: string;
  bgColor?: string;
  fgColor?: string;
  includeMargin?: boolean;
  imageSettings?: {
    src: string;
    x?: number;
    y?: number;
    height?: number;
    width?: number;
    excavate?: boolean;
  };
}

export const QRCodeSVG: React.ForwardRefExoticComponent<
  QRCodeSVGProps & React.RefAttributes<SVGSVGElement>
>;

interface QRCodeCanvasProps extends React.CanvasHTMLAttributes<HTMLCanvasElement> {
  value: string;
  size?: number;
  level?: string;
  bgColor?: string;
  fgColor?: string;
  includeMargin?: boolean;
  imageSettings?: {
    src: string;
    x?: number;
    y?: number;
    height?: number;
    width?: number;
    excavate?: boolean;
  };
}

export const QRCodeCanvas: React.ForwardRefExoticComponent<
  QRCodeCanvasProps & React.RefAttributes<HTMLCanvasElement>
>;
