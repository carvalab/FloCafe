declare global {
  interface Navigator {
    usb: USB;
  }

  interface USB {
    getDevices(): Promise<USBDevice[]>;
    requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
    onconnect: ((event: USBConnectionEvent) => void) | null;
    ondisconnect: ((event: USBConnectionEvent) => void) | null;
    addEventListener(type: 'connect', listener: (event: USBConnectionEvent) => void): void;
    addEventListener(type: 'disconnect', listener: (event: USBConnectionEvent) => void): void;
    removeEventListener(type: 'connect', listener: (event: USBConnectionEvent) => void): void;
    removeEventListener(type: 'disconnect', listener: (event: USBConnectionEvent) => void): void;
  }

  interface USBDeviceRequestOptions {
    filters: USBDeviceFilter[];
  }

  interface USBDeviceFilter {
    vendorId?: number;
    productId?: number;
    classCode?: number;
    subclassCode?: number;
    protocolCode?: number;
    serialNumber?: string;
  }

  interface USBConnectionEvent extends Event {
    device: USBDevice;
  }

  interface USBDevice {
    deviceClass: number;
    deviceSubclass: number;
    deviceProtocol: number;
    vendorId: number;
    productId: number;
    deviceVersionMajor: number;
    deviceVersionMinor: number;
    deviceVersionSubminor: number;
    manufacturerName: string | null;
    productName: string | null;
    serialNumber: string | null;
    configuration: USBConfiguration | null;
    configurations: USBConfiguration[];
    opened: boolean;

    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
    controlTransferIn(setup: USBControlTransferParameters, length: number): Promise<USBInTransferResult>;
    controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource): Promise<USBOutTransferResult>;
    isochronousTransferIn(endpointNumber: number, packetLengths: number[]): Promise<USBIsochronousInTransferResult>;
    isochronousTransferOut(endpointNumber: number, data: BufferSource, packetLengths: number[]): Promise<USBIsochronousOutTransferResult>;
    transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
    transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
    forget(): Promise<void>;
  }

  interface USBConfiguration {
    configurationValue: number;
    configurationName: string | null;
    interfaces: USBInterface[];
  }

  interface USBInterface {
    interfaceNumber: number;
    alternates: USBAlternateInterface[];
    claimed: boolean;
  }

  interface USBAlternateInterface {
    alternateSetting: number;
    interfaceClass: number;
    interfaceSubclass: number;
    interfaceProtocol: number;
    interfaceName: string;
    endpoints: USBEndpoint[];
  }

  interface USBEndpoint {
    endpointNumber: number;
    direction: USBEndpointDirection;
    type: USBTransferType;
    packetSize: number;
  }

  type USBEndpointDirection = 'in' | 'out';
  type USBTransferType = 'control' | 'isochronous' | 'bulk' | 'interrupt';

  interface USBControlTransferParameters {
    requestType: USBRequestType;
    recipient: USBRecipient;
    request: number;
    value: number;
    index: number;
  }

  type USBRequestType = 'standard' | 'class' | 'vendor' | 'reserved';
  type USBRecipient = 'device' | 'interface' | 'endpoint' | 'other';

  interface USBInTransferResult {
    data: DataView | null;
    status: USBTransferStatus;
  }

  interface USBOutTransferResult {
    bytesWritten: number;
    status: USBTransferStatus;
  }

  interface USBIsochronousInTransferResult {
    data: DataView | null;
    packets: USBIsochronousInTransferPacket[];
  }

  interface USBIsochronousInTransferPacket {
    data: DataView | null;
    status: USBTransferStatus;
  }

  interface USBIsochronousOutTransferResult {
    packets: USBIsochronousOutTransferPacket[];
  }

  interface USBIsochronousOutTransferPacket {
    status: USBTransferStatus;
  }

  type USBTransferStatus = 'ok' | 'stall' | 'babble' | 'transfer-error' | 'timeout' | 'cancelled' | 'lost';
}

export {};
